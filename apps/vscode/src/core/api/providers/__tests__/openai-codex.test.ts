import { expect } from "chai"
import { OpenAiCodexHandler } from "../openai-codex"

describe("OpenAiCodexHandler", () => {
	const collectEvent = async (handler: OpenAiCodexHandler, event: unknown) => {
		const processEvent = (
			handler as unknown as {
				processEvent: (event: unknown, model: ReturnType<OpenAiCodexHandler["getModel"]>) => AsyncIterable<any>
			}
		).processEvent.bind(handler)
		const chunks: any[] = []

		for await (const chunk of processEvent(event, handler.getModel())) {
			chunks.push(chunk)
		}

		return chunks
	}

	it("does not emit completed message text after streaming its deltas", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
		const deltaChunks = await collectEvent(handler, {
			type: "response.output_text.delta",
			item_id: "message-1",
			delta: "当前环境未提供 new_task 工具。",
		})
		const doneChunks = await collectEvent(handler, {
			type: "response.output_item.done",
			item: {
				id: "message-1",
				type: "message",
				content: [{ type: "output_text", text: "当前环境未提供 new_task 工具。" }],
			},
		})

		expect(deltaChunks).to.deep.equal([{ type: "text", text: "当前环境未提供 new_task 工具。" }])
		expect(doneChunks).to.deep.equal([])
	})

	it("uses completed message text when no text deltas were received", async () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.6-sol" })
		const chunks = await collectEvent(handler, {
			type: "response.output_item.done",
			item: {
				id: "message-1",
				type: "message",
				content: [{ type: "output_text", text: "done-only response" }],
			},
		})

		expect(chunks).to.deep.equal([{ type: "text", text: "done-only response" }])
	})
})
