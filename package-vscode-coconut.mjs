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

const customPackageFields = {
	name: "cline-coconut",
	displayName: "Cline Coconut",
	publisher: "coconut",
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

async function installIfMissing(env) {
	if (!(await exists(path.join(vscodeDir, "node_modules")))) {
		const installMode = (await exists(path.join(vscodeDir, "package-lock.json"))) ? "ci" : "install"
		await run(commandName("npm"), [installMode], { cwd: vscodeDir, env })
	}

	if (!(await exists(path.join(webviewDir, "node_modules")))) {
		const installMode = (await exists(path.join(webviewDir, "package-lock.json"))) ? "ci" : "install"
		await run(commandName("npm"), [installMode], { cwd: webviewDir, env })
	}
}

async function copyIfExists(relativePath) {
	const source = path.join(vscodeDir, relativePath)
	const destination = path.join(stagingDir, relativePath)

	if (!(await exists(source))) {
		console.warn(`[skip] ${relativePath} not found`)
		return
	}

	await mkdir(path.dirname(destination), { recursive: true })
	await cp(source, destination, { recursive: true, force: true })
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
		await copyIfExists(entry)
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

	// The original source tree has already been built. Do not run prepublish again inside staging.
	delete stagedPackage.scripts["vscode:prepublish"]

	await writeFile(path.join(stagingDir, "package.json"), `${JSON.stringify(stagedPackage, null, "\t")}\n`)
}

async function main() {
	const packagePath = path.join(vscodeDir, "package.json")
	const originalPackage = JSON.parse(await readFile(packagePath, "utf8"))
	const outputFile = path.join(outputDir, `${customPackageFields.name}-${originalPackage.version}.vsix`)
	const env = createBuildEnv()

	console.log("Packaging VS Code extension with staging metadata override")
	console.log(`Source package: ${packagePath}`)
	console.log(`Staging dir:    ${stagingDir}`)
	console.log(`Output file:    ${outputFile}`)
	console.log(`Version:        ${originalPackage.version} (from source package.json)`)

	try {
		await mkdir(outputDir, { recursive: true })
		await installIfMissing(env)

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