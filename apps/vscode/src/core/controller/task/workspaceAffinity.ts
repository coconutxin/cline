import type { HistoryItem } from "@/shared/HistoryItem";
import type { WorkspaceRoot } from "@/shared/multi-root/types";
import { arePathsEqual } from "@/utils/path";

export type WorkspaceAffinityStatus = "matched" | "mismatched" | "unknown";

export interface WorkspaceAffinityCheckResult {
	status: WorkspaceAffinityStatus;
	matches: boolean;
	taskWorkspacePath?: string;
	matchedRootPath?: string;
	currentWorkspacePaths: string[];
}

function nonEmptyPath(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function getHistoryItemWorkspaceAffinityPath(
	historyItem: HistoryItem,
): string | undefined {
	return (
		nonEmptyPath(historyItem.cwdOnTaskInitialization) ??
		nonEmptyPath(historyItem.shadowGitConfigWorkTree)
	);
}

export function checkHistoryItemWorkspaceAffinity(
	historyItem: HistoryItem,
	workspaceRoots: WorkspaceRoot[],
): WorkspaceAffinityCheckResult {
	const taskWorkspacePath = getHistoryItemWorkspaceAffinityPath(historyItem);
	const currentWorkspacePaths = workspaceRoots
		.map((root) => nonEmptyPath(root.path))
		.filter((path): path is string => !!path);

	if (!taskWorkspacePath || currentWorkspacePaths.length === 0) {
		return {
			status: "unknown",
			matches: true,
			taskWorkspacePath,
			currentWorkspacePaths,
		};
	}

	const matchedRootPath = currentWorkspacePaths.find((workspacePath) =>
		arePathsEqual(taskWorkspacePath, workspacePath),
	);

	if (matchedRootPath) {
		return {
			status: "matched",
			matches: true,
			taskWorkspacePath,
			matchedRootPath,
			currentWorkspacePaths,
		};
	}

	return {
		status: "mismatched",
		matches: false,
		taskWorkspacePath,
		currentWorkspacePaths,
	};
}
