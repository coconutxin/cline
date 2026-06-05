import assert from "node:assert/strict"
import * as sinon from "sinon"
import type * as vscode from "vscode"
import { VscodeTerminalProcess } from "../VscodeTerminalProcess"

declare module "vscode" {
	interface Terminal {
		shellIntegration?: {
			cwd?: vscode.Uri
			executeCommand?: (command: string) => {
				read: () => AsyncIterable<string>
			}
		}
	}
}

function createHangingCompletionMarkerStream(): AsyncIterable<string> {
	return {
		async *[Symbol.asyncIterator]() {
			yield "build finished\n]633;D;0\n"
			await new Promise<never>(() => {})
		},
	}
}

describe("VscodeTerminalProcess completion marker fallback", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox({ useFakeTimers: true })
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("finalizes when a completion marker is emitted but the shell integration stream does not end", async () => {
		const process = new VscodeTerminalProcess()
		const mockExecuteCommand = sandbox.stub().returns({
			read: () => createHangingCompletionMarkerStream(),
		})
		const terminal = {
			shellIntegration: {
				executeCommand: mockExecuteCommand,
			},
		} as unknown as vscode.Terminal

		const emitSpy = sandbox.spy(process, "emit")
		const runPromise = process.run(terminal, "build command")

		await Promise.resolve()
		await sandbox.clock.tickAsync(0)
		await runPromise

		assert.equal(mockExecuteCommand.calledWith("build command"), true)
		assert.equal((emitSpy as sinon.SinonSpy).withArgs("completed").callCount, 1)
		assert.equal((emitSpy as sinon.SinonSpy).withArgs("continue").callCount, 1)
		assert.equal(process.getCompletionDetails().exitCode, 0)
	})
})