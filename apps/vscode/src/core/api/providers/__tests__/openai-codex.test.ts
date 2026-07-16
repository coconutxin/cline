import { openAiCodexFastServiceTier } from "@shared/api"
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

	const buildRequestBody = (handler: OpenAiCodexHandler, previousResponseId?: string) => {
		const buildBody = (
			handler as unknown as {
				buildRequestBody: (
					model: ReturnType<OpenAiCodexHandler["getModel"]>,
					formattedInput: unknown[],
					systemPrompt: string,
					tools?: undefined,
					previousResponseId?: string,
				) => Record<string, unknown>
			}
		).buildRequestBody.bind(handler)

		return buildBody(handler.getModel(), [], "system prompt", undefined, previousResponseId)
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

	it("sends the priority service tier for supported models when Fast mode is enabled", () => {
		const handler = new OpenAiCodexHandler({
			apiModelId: "gpt-5.4",
			serviceTier: openAiCodexFastServiceTier,
		})

		expect(buildRequestBody(handler)).to.include({ service_tier: openAiCodexFastServiceTier })
	})

	it("omits the service tier when Fast mode is not enabled", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-5.4" })

		expect(buildRequestBody(handler)).not.to.have.property("service_tier")
	})

	it("omits the priority service tier for models that do not support Fast mode", () => {
		const handler = new OpenAiCodexHandler({
			apiModelId: "gpt-5.3-codex",
			serviceTier: openAiCodexFastServiceTier,
		})

		expect(buildRequestBody(handler)).not.to.have.property("service_tier")
	})

	it("preserves the priority service tier in previous-response request bodies", () => {
		const handler = new OpenAiCodexHandler({
			apiModelId: "gpt-5.6-sol",
			serviceTier: openAiCodexFastServiceTier,
		})

		expect(buildRequestBody(handler, "response-1")).to.include({
			previous_response_id: "response-1",
			service_tier: openAiCodexFastServiceTier,
		})
	})
})
