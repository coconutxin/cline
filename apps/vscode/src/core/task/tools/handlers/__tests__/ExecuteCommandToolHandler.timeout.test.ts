import assert from "node:assert/strict"
import { describe, it } from "mocha"
import {
	getLikelyInteractiveCommandReason,
	isLikelyLongRunningCommand,
	resolveCommandTimeoutSeconds,
} from "../ExecuteCommandToolHandler"

describe("ExecuteCommandToolHandler timeout policy", () => {
	it("returns undefined when managed timeout is disabled", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", undefined, false)
		assert.equal(timeout, undefined)
	})

	it("uses explicit timeout when provided", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", "45", true)
		assert.equal(timeout, 45)
	})

	it("falls back to default timeout for short commands", () => {
		const timeout = resolveCommandTimeoutSeconds("ls -la", undefined, true)
		assert.equal(timeout, 30)
	})

	it("uses extended timeout for known long-running commands", () => {
		const timeout = resolveCommandTimeoutSeconds("npm run build", undefined, true)
		assert.equal(timeout, 300)
	})

	it("detects common long-running command families", () => {
		assert.equal(isLikelyLongRunningCommand("cargo build --release"), true)
		assert.equal(isLikelyLongRunningCommand("docker build ."), true)
		assert.equal(isLikelyLongRunningCommand("pytest -q"), true)
	})
})

describe("ExecuteCommandToolHandler interactive command detection", () => {
	it("blocks obvious REPL commands", () => {
		assert.match(getLikelyInteractiveCommandReason("python") ?? "", /Python REPL/)
		assert.match(getLikelyInteractiveCommandReason("node") ?? "", /Node\.js REPL/)
		assert.match(getLikelyInteractiveCommandReason("cmd") ?? "", /interactive shell/)
		assert.match(getLikelyInteractiveCommandReason("powershell") ?? "", /interactive shell/)
	})

	it("allows non-interactive Python and Node commands", () => {
		assert.equal(getLikelyInteractiveCommandReason("python -c \"print('ok')\""), undefined)
		assert.equal(getLikelyInteractiveCommandReason("python scripts/check.py"), undefined)
		assert.equal(getLikelyInteractiveCommandReason("node -e \"console.log('ok')\""), undefined)
		assert.equal(getLikelyInteractiveCommandReason("node scripts/check.js"), undefined)
	})

	it("blocks common stdin/editor/auth flows", () => {
		assert.match(getLikelyInteractiveCommandReason("pause") ?? "", /keyboard input/)
		assert.match(getLikelyInteractiveCommandReason("choice /c yn") ?? "", /keyboard input/)
		assert.match(getLikelyInteractiveCommandReason("set /p name=Name:") ?? "", /stdin/)
		assert.match(getLikelyInteractiveCommandReason("npm init") ?? "", /npm init -y/)
		assert.match(getLikelyInteractiveCommandReason("git commit") ?? "", /git commit -m/)
		assert.match(getLikelyInteractiveCommandReason("gh auth login") ?? "", /authentication flow/)
	})

	it("allows non-interactive variants for commands that are often interactive", () => {
		assert.equal(getLikelyInteractiveCommandReason("npm init -y"), undefined)
		assert.equal(getLikelyInteractiveCommandReason('git commit -m "update"'), undefined)
		assert.equal(getLikelyInteractiveCommandReason("git commit --no-edit"), undefined)
		assert.equal(getLikelyInteractiveCommandReason("gh auth status"), undefined)
	})
})
