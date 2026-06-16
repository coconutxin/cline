import { StringArrayRequest } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { expect } from "chai"
import type { PathLike, RmOptions } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import type { HistoryItem } from "@/shared/HistoryItem"
import { deleteTasksWithIds } from "../deleteTasksWithIds"

const historyItem = (id: string): HistoryItem => ({
	id,
	ts: Date.now(),
	task: `Task ${id}`,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
})

describe("deleteTasksWithIds", () => {
	const sandbox = sinon.createSandbox()
	let tempDir: string
	let history: HistoryItem[]
	let showMessage: sinon.SinonStub
	let setGlobalState: sinon.SinonStub
	let flushPendingState: sinon.SinonStub
	let postStateToWebview: sinon.SinonStub
	let clearTask: sinon.SinonStub

	const makeController = (taskId?: string) =>
		({
			task: taskId ? { taskId } : undefined,
			clearTask,
			postStateToWebview,
			stateManager: {
				getGlobalStateKey: (key: string) => {
					if (key === "taskHistory") {
						return history
					}
					return undefined
				},
				setGlobalState,
				flushPendingState,
			},
		}) as any

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "delete-tasks-with-ids-"))
		history = [historyItem("task-a"), historyItem("task-b"), historyItem("task-c")]
		showMessage = sandbox.stub().resolves({ selectedOption: "Delete" })
		setGlobalState = sandbox.stub().callsFake((key: string, value: HistoryItem[]) => {
			if (key === "taskHistory") {
				history = value
			}
		})
		flushPendingState = sandbox.stub().resolves()
		postStateToWebview = sandbox.stub().resolves()
		clearTask = sandbox.stub().resolves()

		sandbox.stub(HostProvider, "window").value({
			showMessage,
		} as any)
		sandbox.stub(HostProvider, "get").returns({
			globalStorageFsPath: tempDir,
		} as any)

		await fs.mkdir(path.join(tempDir, "tasks", "task-a"), { recursive: true })
		await fs.writeFile(path.join(tempDir, "tasks", "task-a", "ui_messages.json"), "[]")
		await fs.mkdir(path.join(tempDir, "tasks", "task-c"), { recursive: true })
	})

	afterEach(async () => {
		sandbox.restore()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("removes every requested history item even when some task files are already missing", async () => {
		await deleteTasksWithIds(makeController(), StringArrayRequest.create({ value: ["task-a", "task-b"] }))

		expect(history.map((item) => item.id)).to.deep.equal(["task-c"])
		expect(setGlobalState.calledOnce).to.equal(true)
		expect(setGlobalState.firstCall.args[0]).to.equal("taskHistory")
		expect(await pathExists(path.join(tempDir, "tasks", "task-a"))).to.equal(false)
		expect(await pathExists(path.join(tempDir, "tasks", "task-c"))).to.equal(true)
		expect(flushPendingState.calledOnce).to.equal(true)
		expect(postStateToWebview.calledOnce).to.equal(true)
	})

	it("deduplicates selected ids and clears the active task only once", async () => {
		await deleteTasksWithIds(makeController("task-a"), StringArrayRequest.create({ value: ["task-a", "task-a", "task-b"] }))

		expect(history.map((item) => item.id)).to.deep.equal(["task-c"])
		expect(clearTask.calledOnce).to.equal(true)
		expect(showMessage.firstCall.args[0].message).to.contain("these 2 tasks")
	})

	it("does not mutate state when the user cancels the confirmation", async () => {
		showMessage.resolves({ selectedOption: undefined })
		const originalHistory = history

		await deleteTasksWithIds(makeController(), StringArrayRequest.create({ value: ["task-a", "task-b"] }))

		expect(history).to.equal(originalHistory)
		expect(setGlobalState.called).to.equal(false)
		expect(flushPendingState.called).to.equal(false)
		expect(postStateToWebview.called).to.equal(false)
	})

	it("warns but still completes when a task directory cannot be deleted", async () => {
		const originalRm = fs.rm.bind(fs)
		sandbox.stub(fs, "rm").callsFake(async (targetPath: PathLike, options?: RmOptions) => {
			if (String(targetPath).endsWith(`${path.sep}task-a`)) {
				throw new Error("permission denied")
			}
			return originalRm(targetPath, options)
		})

		await deleteTasksWithIds(makeController(), StringArrayRequest.create({ value: ["task-a", "task-b"] }))

		expect(history.map((item) => item.id)).to.deep.equal(["task-c"])
		expect(showMessage.calledTwice).to.equal(true)
		expect(showMessage.secondCall.args[0].type).to.equal(ShowMessageType.WARNING)
		expect(showMessage.secondCall.args[0].message).to.contain("There may be files left behind")
		expect(flushPendingState.calledOnce).to.equal(true)
		expect(postStateToWebview.calledOnce).to.equal(true)
	})

	it("throws when no task ids are provided", async () => {
		try {
			await deleteTasksWithIds(makeController(), StringArrayRequest.create({ value: [] }))
			throw new Error("Expected deleteTasksWithIds to throw")
		} catch (error) {
			expect((error as Error).message).to.equal("Missing task IDs")
		}
	})
})

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}
