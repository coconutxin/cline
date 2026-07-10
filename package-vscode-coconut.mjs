#!/usr/bin/env node

import { spawn } from "node:child_process"
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const vscodeDir = path.join(rootDir, "apps", "vscode")
const webviewDir = path.join(vscodeDir, "webview-ui")
const outputDir = path.join(rootDir, "output")
const stagingDir = path.join(os.tmpdir(), `cline-coconut-vscode-${process.pid}-${Date.now()}`)
const upstreamRemoteName = "upstream"
const upstreamRemoteUrl = "https://github.com/cline/cline.git"
const syncBranch = "main"
const defaultSyncTag = "v3.89.2"

const customPackageFields = {
	name: "cline-coconut",
	displayName: "Cline Coconut",
	publisher: "coconut",
}

const officialExtensionIdentity = {
	name: "claude-dev",
	publisher: "saoudrizwan",
}

function getExtensionId(pkg) {
	return `${pkg.publisher}.${pkg.name}`
}

function validateCustomExtensionIdentity(pkg) {
	const extensionId = getExtensionId(pkg)
	const expectedExtensionId = getExtensionId(customPackageFields)
	const officialExtensionId = getExtensionId(officialExtensionIdentity)

	if (extensionId !== expectedExtensionId || pkg.displayName !== customPackageFields.displayName) {
		throw new Error(
			`Refusing to package unexpected VS Code extension identity.\n` +
				`Expected: ${expectedExtensionId} (${customPackageFields.displayName})\n` +
				`Actual:   ${extensionId} (${pkg.displayName ?? "<missing displayName>"})`,
		)
	}

	if (extensionId === officialExtensionId) {
		throw new Error(
			`Refusing to package official extension identity '${officialExtensionId}'. ` +
				"A VSIX with the official ID can be auto-updated by VS Code from the Marketplace.",
		)
	}
}

function commandName(name) {
	return process.platform === "win32" ? `${name}.cmd` : name
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

	// `apps/vscode/package.json` runs `bash ./scripts/proto-lint.sh` during packaging.
	// On Windows, Git may be installed but bash may not be visible to the current process PATH.
	if (process.platform === "win32") {
		const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path"
		const existingPath = env[pathKey] ?? ""
		const gitBashDirs = ["C:\\Program Files\\Git\\bin", "C:\\Program Files\\Git\\usr\\bin"]
		env[pathKey] = [...gitBashDirs, existingPath].filter(Boolean).join(path.delimiter)
	}

	return env
}

function parseArgs(argv) {
	const options = {
		syncTag: defaultSyncTag,
	}

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]

		if (arg === "--sync-tag") {
			const value = argv[++index]
			if (!value) {
				throw new Error("--sync-tag requires a tag name")
			}
			options.syncTag = value
			continue
		}

		if (arg.startsWith("--sync-tag=")) {
			const value = arg.slice("--sync-tag=".length)
			if (!value) {
				throw new Error("--sync-tag requires a tag name")
			}
			options.syncTag = value
			continue
		}

		if (arg === "--help" || arg === "-h") {
			printHelp()
			process.exit(0)
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	return options
}

function printHelp() {
	console.log(`Package Cline VS Code extension for local distribution.

Usage:
  node package-vscode-coconut.mjs [options]

Options:
  --sync-tag <tag>  Sync the specified official tag before packaging (default: ${defaultSyncTag})
  -h, --help        Show this help
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
		throw new Error(
			`Git working tree is not clean before ${reason}. Commit or stash changes first.\n\n${status}`,
		)
	}
}

function normalizeSyncTag(syncTag) {
	const tag = syncTag.trim()
	if (!tag) {
		throw new Error("Sync tag cannot be empty")
	}
	return tag
}

async function syncOfficialChanges(syncTag) {
	const normalizedSyncTag = normalizeSyncTag(syncTag)
	const tagRef = `refs/tags/${normalizedSyncTag}`

	console.log(`Syncing official Cline repository tag '${normalizedSyncTag}' before packaging`)

	await capture("git", ["rev-parse", "--is-inside-work-tree"], { cwd: rootDir })
	await ensureCleanWorktree("syncing upstream")
	await capture("git", ["check-ref-format", tagRef], { cwd: rootDir })

	const currentBranch = await capture("git", ["branch", "--show-current"], { cwd: rootDir })
	if (currentBranch !== syncBranch) {
		throw new Error(`Expected to run on branch '${syncBranch}', but current branch is '${currentBranch}'.`)
	}

	const upstreamUrl = await getRemoteUrl(upstreamRemoteName)
	if (!upstreamUrl) {
		await run("git", ["remote", "add", upstreamRemoteName, upstreamRemoteUrl], { cwd: rootDir })
	} else if (upstreamUrl !== upstreamRemoteUrl) {
		await run("git", ["remote", "set-url", upstreamRemoteName, upstreamRemoteUrl], { cwd: rootDir })
	}

	await run("git", ["fetch", "origin"], { cwd: rootDir })
	await run("git", ["fetch", upstreamRemoteName, `${tagRef}:${tagRef}`], { cwd: rootDir })
	const tagCommit = await capture("git", ["rev-parse", "--verify", `${tagRef}^{commit}`], { cwd: rootDir })
	await run("git", ["pull", "--ff-only", "origin", syncBranch], { cwd: rootDir })
	await run("git", ["merge", "--no-edit", tagRef], { cwd: rootDir })
	await run("git", ["push", "origin", syncBranch], { cwd: rootDir })

	await ensureCleanWorktree("packaging after upstream sync")
	console.log(`Official repository tag '${normalizedSyncTag}' (${tagCommit}) sync completed and pushed to fork.`)
}

async function installDependencies(env) {
	for (const directory of [vscodeDir, webviewDir]) {
		const installMode = (await exists(path.join(directory, "package-lock.json"))) ? "ci" : "install"
		await run(commandName("npm"), [installMode], { cwd: directory, env })
	}
}

function hasPathSegment(filePath, segment) {
	return filePath.split(path.sep).includes(segment)
}

async function copyIfExists(relativePath, options = {}) {
	const source = path.join(vscodeDir, relativePath)
	const destination = path.join(stagingDir, relativePath)

	if (!(await exists(source))) {
		console.warn(`[skip] ${relativePath} not found`)
		return
	}

	await mkdir(path.dirname(destination), { recursive: true })
	await cp(source, destination, {
		recursive: true,
		force: true,
		filter: options.excludeNodeModules
			? (sourcePath) => !hasPathSegment(path.relative(source, sourcePath), "node_modules")
			: undefined,
	})
}

async function createStagingPackage(originalPackage) {
	await rm(stagingDir, { recursive: true, force: true })
	await mkdir(stagingDir, { recursive: true })

	const entriesToStage = [
		".vscodeignore",
		".env.example",
		".nycrc.unit.json",
		"biome.jsonc",
		"esbuild.mjs",
		"knip.json",
		"package.json",
		"README.md",
		"skills-lock.json",
		"test-setup.js",
		"assets",
		"dist",
		"proto",
		"scripts",
		"testing-platform",
		"tests",
		path.join("webview-ui", "build"),
	]

	for (const entry of entriesToStage) {
		await copyIfExists(entry, { excludeNodeModules: true })
	}

	// The extension CSS references VS Code codicons. The project .vscodeignore explicitly
	// re-includes these two files while ignoring the rest of node_modules.
	for (const codiconFile of ["codicon.css", "codicon.ttf"]) {
		await copyIfExists(path.join("node_modules", "@vscode", "codicons", "dist", codiconFile))
	}

	const rootLicense = path.join(rootDir, "LICENSE")
	if (await exists(rootLicense)) {
		await cp(rootLicense, path.join(stagingDir, "LICENSE"), { force: true })
	}

	const stagedPackage = {
		...originalPackage,
		...customPackageFields,
		version: originalPackage.version,
		scripts: {
			...(originalPackage.scripts ?? {}),
		},
	}

	validateCustomExtensionIdentity(stagedPackage)
	console.log(`Staged extension ID: ${getExtensionId(stagedPackage)}`)

	// The original source tree has already been built. Do not run prepublish again inside staging.
	delete stagedPackage.scripts["vscode:prepublish"]

	await writeFile(path.join(stagingDir, "package.json"), `${JSON.stringify(stagedPackage, null, "\t")}\n`)
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const packagePath = path.join(vscodeDir, "package.json")
	const env = createBuildEnv()

	console.log("Packaging VS Code extension with staging metadata override")
	console.log(`Source package: ${packagePath}`)
	console.log(`Staging dir:    ${stagingDir}`)
	console.log(`Sync tag:       ${options.syncTag}`)

	try {
		await syncOfficialChanges(options.syncTag)

		const originalPackage = JSON.parse(await readFile(packagePath, "utf8"))
		const outputFile = path.join(outputDir, `${customPackageFields.name}-${originalPackage.version}.vsix`)

		console.log(`Output file:    ${outputFile}`)
		console.log(`Version:        ${originalPackage.version} (from source package.json after upstream sync)`)

		await mkdir(outputDir, { recursive: true })
		await installDependencies(env)

		await run(commandName("npm"), ["run", "package"], { cwd: vscodeDir, env })
		await createStagingPackage(originalPackage)

		const vsceBin = path.join(vscodeDir, "node_modules", "@vscode", "vsce", "vsce")
		if (!(await exists(vsceBin))) {
			throw new Error(`Cannot find local vsce executable at ${vsceBin}. Run npm install in ${vscodeDir}.`)
		}

		await rm(outputFile, { force: true })
		await run(
			process.execPath,
			[vsceBin, "package", "--no-dependencies", "--allow-package-secrets", "sendgrid", "--out", outputFile],
			{ cwd: stagingDir, env },
		)

		console.log(`\nDone: ${outputFile}`)
	} finally {
		await rm(stagingDir, { recursive: true, force: true })
	}
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})