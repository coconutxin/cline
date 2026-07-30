import { describe, it } from "mocha"
import "should"

import { StateUpdateCoordinator } from "../StateUpdateCoordinator"

describe("StateUpdateCoordinator", () => {
	it("discards an older read when an update is requested before the read completes", async () => {
		let resolveFirstRead: ((state: string) => void) | undefined
		let readCount = 0
		const publishedStates: string[] = []

		const coordinator = new StateUpdateCoordinator({
			readState: async () => {
				readCount += 1
				if (readCount === 1) {
					return new Promise<string>((resolve) => {
						resolveFirstRead = resolve
					})
				}
				return "latest"
			},
			publishState: async (state) => {
				publishedStates.push(state)
			},
		})

		const firstUpdate = coordinator.requestUpdate()
		const secondUpdate = coordinator.requestUpdate()
		resolveFirstRead?.("stale")

		await Promise.all([firstUpdate, secondUpdate])

		readCount.should.equal(2)
		publishedStates.should.deepEqual(["latest"])
	})

	it("coalesces multiple updates received during an in-flight read", async () => {
		let resolveFirstRead: ((state: number) => void) | undefined
		let latestState = 0
		let readCount = 0
		const publishedStates: number[] = []

		const coordinator = new StateUpdateCoordinator({
			readState: async () => {
				readCount += 1
				if (readCount === 1) {
					return new Promise<number>((resolve) => {
						resolveFirstRead = resolve
					})
				}
				return latestState
			},
			publishState: async (state) => {
				publishedStates.push(state)
			},
		})

		const updates = [coordinator.requestUpdate()]
		for (latestState = 1; latestState <= 5; latestState += 1) {
			updates.push(coordinator.requestUpdate())
		}
		latestState = 5
		resolveFirstRead?.(0)

		await Promise.all(updates)

		readCount.should.equal(2)
		publishedStates.should.deepEqual([5])
	})

	it("publishes a follow-up snapshot after an update arrives during publication", async () => {
		let latestState = "old"
		let resolveFirstPublish: (() => void) | undefined
		const publishedStates: string[] = []

		const coordinator = new StateUpdateCoordinator({
			readState: async () => latestState,
			publishState: async (state) => {
				publishedStates.push(state)
				if (state === "old") {
					await new Promise<void>((resolve) => {
						resolveFirstPublish = resolve
					})
				}
			},
		})

		const firstUpdate = coordinator.requestUpdate()
		await Promise.resolve()

		latestState = "new"
		let secondUpdateResolved = false
		const secondUpdate = coordinator.requestUpdate().then(() => {
			secondUpdateResolved = true
		})

		await Promise.resolve()
		secondUpdateResolved.should.equal(false)

		resolveFirstPublish?.()
		await Promise.all([firstUpdate, secondUpdate])

		publishedStates.should.deepEqual(["old", "new"])
		secondUpdateResolved.should.equal(true)
	})

	it("continues processing newer updates after a publication fails", async () => {
		let latestState = "first"
		let publishCount = 0
		const publishedStates: string[] = []

		const coordinator = new StateUpdateCoordinator({
			readState: async () => latestState,
			publishState: async (state) => {
				publishCount += 1
				if (publishCount === 1) {
					throw new Error("publish failed")
				}
				publishedStates.push(state)
			},
		})

		await coordinator.requestUpdate().should.be.rejectedWith("publish failed")

		latestState = "second"
		await coordinator.requestUpdate()

		publishedStates.should.deepEqual(["second"])
	})
})
