import { describe, it } from "mocha";
import "should";
import { VcsType, type WorkspaceRoot } from "@/shared/multi-root/types";
import {
	checkHistoryItemWorkspaceAffinity,
	getHistoryItemWorkspaceAffinityPath,
} from "./workspaceAffinity";

const root = (path: string): WorkspaceRoot => ({
	path,
	name: path.split(/[\\/]/).pop(),
	vcs: VcsType.None,
});

describe("workspaceAffinity", () => {
	it("uses cwdOnTaskInitialization before legacy shadowGitConfigWorkTree", () => {
		const affinityPath = getHistoryItemWorkspaceAffinityPath({
			id: "task-1",
			ts: 1,
			task: "task",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/workspace/current",
			shadowGitConfigWorkTree: "/workspace/legacy",
		});

		if (!affinityPath) {
			throw new Error("Expected workspace affinity path to be defined");
		}

		affinityPath.should.equal("/workspace/current");
	});

	it("matches a task to any current workspace root", () => {
		const result = checkHistoryItemWorkspaceAffinity(
			{
				id: "task-1",
				ts: 1,
				task: "task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				cwdOnTaskInitialization: "/workspace/backend",
			},
			[root("/workspace/frontend"), root("/workspace/backend")],
		);

		result.status.should.equal("matched");
		result.matches.should.equal(true);
		result.matchedRootPath?.should.equal("/workspace/backend");
	});

	it("rejects a task from a different workspace", () => {
		const result = checkHistoryItemWorkspaceAffinity(
			{
				id: "task-1",
				ts: 1,
				task: "task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				cwdOnTaskInitialization: "/workspace/project-a",
			},
			[root("/workspace/project-b")],
		);

		result.status.should.equal("mismatched");
		result.matches.should.equal(false);
	});

	it("allows legacy tasks with unknown workspace affinity", () => {
		const result = checkHistoryItemWorkspaceAffinity(
			{
				id: "legacy-task",
				ts: 1,
				task: "legacy task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			},
			[root("/workspace/project")],
		);

		result.status.should.equal("unknown");
		result.matches.should.equal(true);
	});

	it("compares paths case-insensitively on Windows", function () {
		if (process.platform !== "win32") {
			this.skip();
		}

		const result = checkHistoryItemWorkspaceAffinity(
			{
				id: "task-1",
				ts: 1,
				task: "task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				cwdOnTaskInitialization: "C:\\Workspace\\Project",
			},
			[root("c:\\workspace\\project")],
		);

		result.status.should.equal("matched");
		result.matches.should.equal(true);
	});
});
