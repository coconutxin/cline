import { StringRequest } from "@shared/proto/cline/common";
import { describe, it } from "mocha";
import sinon from "sinon";
import "should";
import { showTaskWithId } from "./showTaskWithId";

describe("showTaskWithId", () => {
	it("does not initialize a history task when workspace affinity check fails", async () => {
		const initTask = sinon.stub().resolves("task-1");
		const controller = {
			stateManager: {
				getGlobalStateKey: sinon
					.stub()
					.withArgs("taskHistory")
					.returns([
						{
							id: "task-1",
							ts: 1,
							task: "wrong workspace task",
							tokensIn: 0,
							tokensOut: 0,
							totalCost: 0,
							cwdOnTaskInitialization: "/workspace/project-a",
						},
					]),
			},
			ensureHistoryItemMatchesCurrentWorkspace: sinon.stub().resolves(false),
			initTask,
		};

		const response = await showTaskWithId(
			controller as any,
			StringRequest.create({ value: "task-1" }),
		);

		initTask.called.should.equal(false);
		response.id.should.equal("task-1");
	});
});
