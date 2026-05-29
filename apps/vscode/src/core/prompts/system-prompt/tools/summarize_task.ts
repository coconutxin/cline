import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.SUMMARIZE_TASK

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "summarize_task",
	description:
		"Create a comprehensive summary of the conversation so far when the context window is running out of space, preserving the information required to continue the task in the same conversation after automatic compaction.",
	contextRequirements: (context) => context.activeContextManagementTool === ClineDefaultTool.SUMMARIZE_TASK,
	parameters: [
		{
			name: "context",
			required: true,
			instruction:
				"The comprehensive summary used for automatic context compaction. Follow the summarize_task instructions and include the sections needed to continue the task accurately, including current work and required files when applicable.",
			usage: "Comprehensive summary for automatic task compaction",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const summarize_task_variants = [generic]