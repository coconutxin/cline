import assert from "node:assert/strict"
import { describe, it } from "mocha"
import sinon from "sinon"
import * as disk from "@core/storage/disk"
import { ClineDefaultTool } from "@/shared/tools"
import { TaskState } from "../../../TaskState"
import { CondenseHandler } from "../CondenseHandler"
import { SummarizeTaskHandler } from "../SummarizeTaskHandler"

describe("condensed context handlers", () => {
	it("manual condense reloads accepted summary as authoritative context", async () => {
		const taskState = new TaskState()
		const handler = new CondenseHandler()
		const truncationStrategies: string[] = []
		const ensureTaskDirectoryExistsStub = sinon.stub(disk, "ensureTaskDirectoryExists").resolves("task-dir")

		try {
			const result = await handler.execute(
				{
					taskId: "task-1",
					autoApprovalSettings: { enableNotifications: false },
					taskState,
					messageState: {
						getApiConversationHistory: () => [{ role: "user" }, { role: "assistant" }, { role: "assistant" }],
						saveClineMessagesAndUpdateHistory: async () => {},
					},
					services: {
						contextManager: {
							getNextTruncationRange: (_history: unknown, _range: unknown, keep: string) => {
								truncationStrategies.push(keep)
								return [2, 2] as [number, number]
							},
							triggerApplyStandardContextTruncationNoticeChange: async () => {},
						},
					},
					callbacks: {
						ask: async () => ({ response: "yesButtonClicked" }),
						say: async () => undefined,
					},
				} as any,
				{
					name: ClineDefaultTool.CONDENSE,
					params: {
						context: "<thinking>internal draft</thinking>\n\n1. Ask the user what to do next",
					},
				} as any,
			)

			const handoff = taskState.userMessageContent[0] as { type: string; text: string }

			assert.equal(taskState.userMessageContent.length, 1)
			assert.equal(handoff.type, "text")
			assert.match(handoff.text, /<condensed_context source="manual">/)
			assert.doesNotMatch(handoff.text, /<thinking>/)
			assert.match(String(result), /ONLY asking the user what you should work on next/i)
			assert.deepEqual(truncationStrategies, ["lastTwo"])
			assert.equal(ensureTaskDirectoryExistsStub.calledOnce, true)
		} finally {
			ensureTaskDirectoryExistsStub.restore()
		}
	})

	it("auto summarize reloads condensed summary before returning the tool result", async () => {
		const taskState = new TaskState()
		const handler = new SummarizeTaskHandler({} as any)
		const ensureTaskDirectoryExistsStub = sinon.stub(disk, "ensureTaskDirectoryExists").resolves("task-dir")

		try {
			const result = await handler.execute(
				{
					taskId: "task-2",
					ulid: "01-test",
					taskState,
					api: {
						getModel: () => ({ id: "claude-sonnet-4" }),
					},
					messageState: {
						getApiConversationHistory: () => [{ role: "user" }, { role: "assistant" }, { role: "user" }],
						getClineMessages: () => [],
						saveClineMessagesAndUpdateHistory: async () => {},
					},
					services: {
						stateManager: {
							getGlobalSettingsKey: (key: string) => {
								if (key === "hooksEnabled") {
									return false
								}
								if (key === "mode") {
									return "act"
								}
								return undefined
							},
							getApiConfiguration: () => ({ actModeApiProvider: "anthropic" }),
						},
						contextManager: {
							getNextTruncationRange: () => [2, 2] as [number, number],
							triggerApplyStandardContextTruncationNoticeChange: async () => {},
							getContextTelemetryData: () => null,
						},
						fileContextTracker: {
							trackFileContext: async () => {},
						},
					},
					callbacks: {
						say: async () => undefined,
						shouldAutoApproveToolWithPath: async () => false,
					},
				} as any,
				{
					name: ClineDefaultTool.SUMMARIZE_TASK,
					params: {
						context: "<thinking>private chain</thinking>\n\n1. Resume the last implementation step",
					},
				} as any,
			)

			const handoff = taskState.userMessageContent[0] as { type: string; text: string }

			assert.equal(taskState.userMessageContent.length, 1)
			assert.equal(handoff.type, "text")
			assert.match(handoff.text, /<condensed_context source="auto">/)
			assert.doesNotMatch(handoff.text, /<thinking>/)
			assert.match(handoff.text, /Resume the last implementation step/)
			assert.match(String(result), /reloaded into this message as authoritative context/i)
			assert.equal(taskState.currentlySummarizing, true)
			assert.equal(ensureTaskDirectoryExistsStub.calledOnce, true)
		} finally {
			ensureTaskDirectoryExistsStub.restore()
		}
	})
})