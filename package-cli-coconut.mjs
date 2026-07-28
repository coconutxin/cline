#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { access, cp, mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const cliDir = path.join(rootDir, "apps", "cli")
const outputDir = path.join(rootDir, "output", "cli")
const upstreamRemoteName = "upstream"
const upstreamRemoteUrl = "https://github.com/cline/cline.git"
const syncBranch = "main"
const defaultSyncTag = "v4.0.11"

const requiredNodeMajor = 22
const requiredBunVersion = "1.3.13"

function commandName(name) {
	if (process.platform !== "win32") {
		return name
	}

	// WinGet installs Bun as bun.exe under its package directory. There may not
	// be a bun.cmd shim in the current shell until PATH is refreshed.
	return name === "bun" ? "bun.exe" : `${name}.cmd`
}

async function exists(filePath) {
	try {
		await access(filePath)
		return true
	} catch {
		return false
	}
}

function createBuildEnv() {
	const env = {
		...process.env,
		PUPPETEER_SKIP_DOWNLOAD: "true",
	}

	// Keep parity with the VS Code packaging script: several repo scripts invoke
	// bash on Windows, so make Git Bash discoverable when it is installed in the
	// default location.
	if (process.platform === "win32") {
		const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path"
		const existingPath = env[pathKey] ?? ""
		const gitBashDirs = ["C:\\Program Files\\Git\\bin", "C:\\Program Files\\Git\\usr\\bin"]
		const wingetBunRoot = process.env.LOCALAPPDATA
			? path.join(
					process.env.LOCALAPPDATA,
					"Microsoft",
					"WinGet",
					"Packages",
					"Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
				)
			: undefined
		const bunDirs = [
			wingetBunRoot ? path.join(wingetBunRoot, "bun-windows-x64") : undefined,
			wingetBunRoot ? path.join(wingetBunRoot, "bun-windows-aarch64") : undefined,
			process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".bun", "bin") : undefined,
		].filter((dir) => dir && existsSync(path.join(dir, "bun.exe")))

		env[pathKey] = [...gitBashDirs, ...bunDirs, existingPath].filter(Boolean).join(path.delimiter)
	}

	return env
}

function parseArgs(argv) {
	const options = {
		sync: false,
		all: false,
		install: true,
		zip: process.platform === "win32",
		syncTag: defaultSyncTag,
	}

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]

		switch (arg) {
			case "--sync":
				options.sync = true
				break
			case "--skip-sync":
				options.sync = false
				break
			case "--all":
				options.all = true
				break
			case "--single":
				options.all = false
				break
			case "--skip-install":
				options.install = false
				break
			case "--no-zip":
				options.zip = false
				break
			case "--zip":
				options.zip = true
				break
			case "--sync-tag": {
				const value = argv[++index]
				if (!value) {
					throw new Error("--sync-tag requires a tag name")
				}
				options.syncTag = value
				break
			}
			case "--help":
			case "-h":
				printHelp()
				process.exit(0)
			default:
				if (arg.startsWith("--sync-tag=")) {
					const value = arg.slice("--sync-tag=".length)
					if (!value) {
						throw new Error("--sync-tag requires a tag name")
					}
					options.syncTag = value
					break
				}
				throw new Error(`Unknown argument: ${arg}`)
		}
	}

	return options
}

function printHelp() {
	console.log(`Package Cline CLI for local distribution.

Usage:
  node package-cli-coconut.mjs [options]

Options:
  --single         Build only the current platform binary (default)
  --all            Build all supported platform binaries
  --sync           Sync the specified official tag before packaging
  --sync-tag <tag> Tag to sync when --sync is used (default: ${defaultSyncTag})
  --skip-sync      Do not sync an official tag (default)
  --skip-install   Skip bun install
  --zip            Create zip archives from copied package directories
  --no-zip         Do not create zip archives
  -h, --help       Show this help

Output:
  output/cli/cline-cli-v<version>/<cli-platform-arch>/
`)
}

async function run(command, args, options = {}) {
	console.log(`\n> ${command} ${args.join(" ")}`)

	await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
			...options,
		})

		child.on("error", reject)
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve()
				return
			}

			reject(new Error(`${command} exited with ${code ?? signal}`))
		})
	})
}

async function capture(command, args, options = {}) {
	const result = await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
			...options,
		})

		let stdout = ""
		let stderr = ""

		child.stdout?.on("data", (data) => {
			stdout += data.toString()
		})

		child.stderr?.on("data", (data) => {
			stderr += data.toString()
		})

		child.on("error", reject)
		child.on("exit", (code, signal) => {
			resolve({ code, signal, stdout, stderr })
		})
	})

	if (result.code !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with ${result.code ?? result.signal}\n${result.stderr}${result.stdout}`,
		)
	}

	return result.stdout.trim()
}

function parseMajor(versionText) {
	const match = versionText.trim().match(/^v?(\d+)\./)
	return match ? Number(match[1]) : Number.NaN
}

async function verifyEnvironment(env) {
	const nodeVersion = await capture(process.execPath, ["--version"], { cwd: rootDir, env })
	const nodeMajor = parseMajor(nodeVersion)
	if (!Number.isFinite(nodeMajor) || nodeMajor < requiredNodeMajor) {
		throw new Error(
			`Node.js ${requiredNodeMajor}+ is required for CLI packaging. Current: ${nodeVersion}. ` +
				`Please install Node.js ${requiredNodeMajor} and reopen the terminal/VS Code.`,
		)
	}

	let bunVersion
	try {
		bunVersion = await capture(commandName("bun"), ["--version"], { cwd: rootDir, env })
	} catch (error) {
		throw new Error(
			`Bun ${requiredBunVersion} is required but bun was not found in PATH. ` +
				`Install it with: winget install --id Oven-sh.Bun -e --version ${requiredBunVersion}`,
		)
	}

	if (bunVersion !== requiredBunVersion) {
		throw new Error(
			`Bun ${requiredBunVersion} is required for reproducible CLI packaging. Current: ${bunVersion}.`,
		)
	}

	console.log(`Node.js: ${nodeVersion}`)
	console.log(`Bun:     ${bunVersion}`)
}

async function getRemoteUrl(remoteName) {
	const result = await new Promise((resolve, reject) => {
		const child = spawn("git", ["remote", "get-url", remoteName], {
			cwd: rootDir,
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""

		child.stdout?.on("data", (data) => {
			stdout += data.toString()
		})

		child.stderr?.on("data", (data) => {
			stderr += data.toString()
		})

		child.on("error", reject)
		child.on("exit", (code) => {
			resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() })
		})
	})

	if (result.code !== 0) {
		return undefined
	}

	return result.stdout
}

async function ensureCleanWorktree(reason) {
	const status = await capture("git", ["status", "--porcelain"], { cwd: rootDir })

	if (status) {
		throw new Error(`Git working tree is not clean before ${reason}. Commit or stash changes first.\n\n${status}`)
	}
}

function normalizeSyncTag(syncTag) {
	const tag = syncTag.trim()
	if (!tag) {
		throw new Error("Sync tag cannot be empty")
	}
	return tag
}

async function syncOfficialChanges(env, syncTag) {
	const normalizedSyncTag = normalizeSyncTag(syncTag)
	const tagRef = `refs/tags/${normalizedSyncTag}`

	console.log(`Syncing official Cline repository tag '${normalizedSyncTag}' before packaging`)

	await capture("git", ["rev-parse", "--is-inside-work-tree"], { cwd: rootDir, env })
	await ensureCleanWorktree("syncing upstream")
	await capture("git", ["check-ref-format", tagRef], { cwd: rootDir, env })

	const currentBranch = await capture("git", ["branch", "--show-current"], { cwd: rootDir, env })
	if (currentBranch !== syncBranch) {
		throw new Error(`Expected to run on branch '${syncBranch}', but current branch is '${currentBranch}'.`)
	}

	const upstreamUrl = await getRemoteUrl(upstreamRemoteName)
	if (!upstreamUrl) {
		await run("git", ["remote", "add", upstreamRemoteName, upstreamRemoteUrl], { cwd: rootDir, env })
	} else if (upstreamUrl !== upstreamRemoteUrl) {
		await run("git", ["remote", "set-url", upstreamRemoteName, upstreamRemoteUrl], { cwd: rootDir, env })
	}

	await run("git", ["fetch", "origin"], { cwd: rootDir, env })
	await run("git", ["fetch", upstreamRemoteName, `${tagRef}:${tagRef}`], { cwd: rootDir, env })
	const tagCommit = await capture("git", ["rev-parse", "--verify", `${tagRef}^{commit}`], { cwd: rootDir, env })
	await run("git", ["pull", "--ff-only", "origin", syncBranch], { cwd: rootDir, env })
	await run("git", ["merge", "--no-edit", tagRef], { cwd: rootDir, env })
	await run("git", ["push", "origin", syncBranch], { cwd: rootDir, env })

	await ensureCleanWorktree("packaging after upstream sync")
	console.log(`Official repository tag '${normalizedSyncTag}' (${tagCommit}) sync completed and pushed to fork.`)
}

function getCurrentPlatformDirName() {
	const displayOs = process.platform === "win32" ? "windows" : process.platform
	return `cli-${displayOs}-${process.arch}`
}

async function readCliPackage() {
	return JSON.parse(await readFile(path.join(cliDir, "package.json"), "utf8"))
}

async function installDependencies(env) {
	await run(commandName("bun"), ["install"], { cwd: rootDir, env })
}

async function buildCli(options, env) {
	const script = options.all ? "build:platforms" : "build:platforms:single"
	await run(commandName("bun"), ["-F", "@cline/cli", script], { cwd: rootDir, env })
}

async function copyBuildOutputs(options, version) {
	const distDir = path.join(cliDir, "dist")
	if (!(await exists(distDir))) {
		throw new Error(`CLI dist directory was not created: ${distDir}`)
	}

	const packageOutputRoot = path.join(outputDir, `cline-cli-v${version}`)
	await rm(packageOutputRoot, { recursive: true, force: true })
	await mkdir(packageOutputRoot, { recursive: true })

	const dirNames = options.all
		? [
				"cli-linux-arm64",
				"cli-linux-x64",
				"cli-darwin-arm64",
				"cli-darwin-x64",
				"cli-windows-x64",
				"cli-windows-arm64",
			]
		: [getCurrentPlatformDirName()]

	const copiedDirs = []
	for (const dirName of dirNames) {
		const source = path.join(distDir, dirName)
		if (!(await exists(source))) {
			throw new Error(`Expected build output was not found: ${source}`)
		}

		const destination = path.join(packageOutputRoot, dirName)
		await cp(source, destination, { recursive: true, force: true })
		copiedDirs.push(destination)
	}

	return { packageOutputRoot, copiedDirs }
}

async function createZipArchives(copiedDirs, env) {
	if (process.platform !== "win32") {
		console.warn("[skip] zip archives are only created automatically on Windows.")
		return []
	}

	const zipFiles = []
	for (const dir of copiedDirs) {
		const zipFile = `${dir}.zip`
		await rm(zipFile, { force: true })
		await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				`Compress-Archive -Path '${dir.replaceAll("'", "''")}\\*' -DestinationPath '${zipFile.replaceAll("'", "''")}' -Force`,
			],
			{ cwd: rootDir, env },
		)
		zipFiles.push(zipFile)
	}

	return zipFiles
}

async function smokeTestCurrentPlatform(packageOutputRoot, version, env) {
	const currentDirName = getCurrentPlatformDirName()
	const binaryName = process.platform === "win32" ? "cline.exe" : "cline"
	const binaryPath = path.join(packageOutputRoot, currentDirName, "bin", binaryName)

	if (!(await exists(binaryPath))) {
		console.warn(`[skip] current-platform smoke test binary not found: ${binaryPath}`)
		return
	}

	const actualVersion = await capture(binaryPath, ["--version"], { cwd: rootDir, env })
	if (actualVersion !== version) {
		throw new Error(`Smoke test failed: expected ${version}, got ${actualVersion}`)
	}

	console.log(`Smoke test passed: ${binaryPath} --version -> ${actualVersion}`)
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const env = createBuildEnv()

	console.log("Packaging Cline CLI")
	console.log(`Source package: ${path.join(cliDir, "package.json")}`)
	console.log(`Output dir:     ${outputDir}`)
	console.log(`Mode:           ${options.all ? "all platforms" : "current platform"}`)
	console.log(`Sync tag:       ${options.sync ? options.syncTag : "no"}`)

	await verifyEnvironment(env)

	if (options.sync) {
		await syncOfficialChanges(env, options.syncTag)
	}

	const cliPackage = await readCliPackage()
	console.log(`Version:        ${cliPackage.version}`)

	if (options.install) {
		await installDependencies(env)
	}

	await buildCli(options, env)
	const { packageOutputRoot, copiedDirs } = await copyBuildOutputs(options, cliPackage.version)
	const zipFiles = options.zip ? await createZipArchives(copiedDirs, env) : []
	await smokeTestCurrentPlatform(packageOutputRoot, cliPackage.version, env)

	console.log("\nDone.")
	console.log(`Output root: ${packageOutputRoot}`)
	for (const dir of copiedDirs) {
		console.log(`Package:     ${dir}`)
	}
	for (const zipFile of zipFiles) {
		console.log(`Archive:     ${zipFile}`)
	}
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})