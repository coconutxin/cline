import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { buildCondensedContextHandoff, continuationPrompt, sanitizeCondensedSummary } from "../contextManagement"

describe("contextManagement condensed context handoff", () => {
	it("strips leading thinking blocks from condensed summaries", () => {
		const result = sanitizeCondensedSummary("<thinking>internal notes</thinking>\n\n1. Keep this summary")

		assert.equal(result, "1. Keep this summary")
	})

	it("builds an authoritative auto handoff prompt", () => {
		const result = buildCondensedContextHandoff("1. Continue implementation", "auto")

		assert.match(result, /<condensed_context source="auto">/)
		assert.match(result, /authoritative context/i)
		assert.match(result, /Continue the conversation from where we left it off/i)
	})

	it("builds a manual handoff prompt without leaking thinking tags", () => {
		const result = buildCondensedContextHandoff(
			"<thinking>draft reasoning</thinking>\n\n1. Ask the user what to work on next",
			"manual",
		)

		assert.match(result, /<condensed_context source="manual">/)
		assert.doesNotMatch(result, /<thinking>/)
		assert.match(result, /Follow any additional instructions elsewhere in this message/i)
	})

	it("continuationPrompt delegates to the auto handoff format", () => {
		const result = continuationPrompt("1. Resume work")

		assert.match(result, /<condensed_context source="auto">/)
		assert.match(result, /Resume work/)
	})
})