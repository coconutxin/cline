import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.CONDENSE

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "condense",
	description:
		"Create a detailed summary of the conversation so far so the current context window can be compacted while retaining the information needed to continue the same task.",
	contextRequirements: (context) => context.activeContextManagementTool === ClineDefaultTool.CONDENSE,
	parameters: [
		{
			name: "context",
			required: true,
			instruction:
				"The detailed conversation summary to continue working from after compaction. Follow the current condense instructions and include the important conversation history, current work, technical concepts, relevant files/code, problem solving, and pending next steps needed to continue the same task.",
			usage: "Detailed summary for continuing the same task after compaction",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

export const condense_variants = [generic]