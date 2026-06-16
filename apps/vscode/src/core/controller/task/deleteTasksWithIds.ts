import { Empty, StringArrayRequest } from "@shared/proto/cline/common"
import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Deletes tasks with the specified IDs
 * @param controller The controller instance
 * @param request The request containing an array of task IDs to delete
 * @returns Empty response
 * @throws Error if operation fails
 */
export async function deleteTasksWithIds(controller: Controller, request: StringArrayRequest): Promise<Empty> {
	const uniqueTaskIds = Array.from(new Set((request.value || []).map((id) => id.trim()).filter(Boolean)))

	if (uniqueTaskIds.length === 0) {
		throw new Error("Missing task IDs")
	}

	const taskCount = uniqueTaskIds.length
	const message =
		taskCount === 1
			? "Are you sure you want to delete this task? This action cannot be undone."
			: `Are you sure you want to delete these ${taskCount} tasks? This action cannot be undone.`

	const userChoice = await HostProvider.window.showMessage({
		type: ShowMessageType.WARNING,
		message,
		options: { modal: true, items: ["Delete"] },
	})

	if (userChoice.selectedOption !== "Delete") {
		return Empty.create()
	}

	const taskIdsToDelete = new Set(uniqueTaskIds)

	// Clear current task once if it is included in the batch.
	if (controller.task?.taskId && taskIdsToDelete.has(controller.task.taskId)) {
		await controller.clearTask()
		Logger.debug("cleared task")
	}

	// Remove all requested tasks from state in one update. Do not call getTaskWithId here:
	// it requires api_conversation_history.json to exist and would abort the whole
	// batch for stale history entries whose files are already gone.
	const taskHistory = controller.stateManager.getGlobalStateKey("taskHistory")
	const updatedTaskHistory = taskHistory.filter((task) => !taskIdsToDelete.has(task.id))
	controller.stateManager.setGlobalState("taskHistory", updatedTaskHistory)

	const failedDeletes: Array<{ id: string; error: unknown }> = []
	const tasksDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks")

	// Best-effort cleanup: a missing task directory should not prevent the rest
	// of the selected tasks from being removed from history or disk.
	for (const id of uniqueTaskIds) {
		try {
			await fs.rm(path.join(tasksDirPath, id), {
				recursive: true,
				force: true,
			})
		} catch (error) {
			failedDeletes.push({ id, error })
			Logger.error(`Error deleting task files for ${id}:`, error)
		}
	}

	// If no tasks remain, clean up root task/checkpoint directories. This is also
	// best-effort; leftover files should not roll back the history deletion.
	if (updatedTaskHistory.length === 0) {
		const checkpointsDirPath = path.join(HostProvider.get().globalStorageFsPath, "checkpoints")

		for (const dirPath of [tasksDirPath, checkpointsDirPath]) {
			try {
				await fs.rm(dirPath, { recursive: true, force: true })
			} catch (error) {
				Logger.error(`Error deleting ${dirPath}:`, error)
				failedDeletes.push({ id: dirPath, error })
			}
		}
	}

	if (failedDeletes.length > 0) {
		await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Deleted selected task history, but encountered errors while deleting ${failedDeletes.length} task file location${failedDeletes.length === 1 ? "" : "s"}. There may be files left behind.`,
		})
	}

	await controller.stateManager.flushPendingState()
	await controller.postStateToWebview()

	return Empty.create()
}
