import { describe, expect, it, vi } from "vitest";
import { batchBodySchema } from "../routes/schemas";
import type { CreateJobParams, JobRow, JobStatus, UpdateStatusPatch } from "./repo";
import { startJob } from "./start";
import type { JobParams } from "./workflow";

const params: JobParams = {
	jobId: "job_1",
	userId: "user_1",
	type: "batch",
	request: batchBodySchema.parse({ urls: ["https://example.com"] }),
};

const harness = () => {
	let row: JobRow | undefined;
	const updates: JobStatus[] = [];
	const jobs = {
		createJob: async (input: CreateJobParams): Promise<JobRow> => {
			row = {
				...input,
				status: "queued",
				total: input.total ?? 0,
				workflowInstanceId: input.workflowInstanceId ?? null,
				succeeded: 0,
				failed: 0,
				creditsUsed: 0,
				error: null,
				createdAt: new Date(0),
				updatedAt: new Date(0),
			};
			return row;
		},
		updateStatus: async (_id: string, status: JobStatus, patch: UpdateStatusPatch = {}) => {
			updates.push(status);
			if (!row || row.status === "completed" || row.status === "failed") return;
			if (status === "queued" && row.status !== "queued") return;
			row.status = status;
			if (patch.error !== undefined) row.error = patch.error;
		},
	};
	return { jobs, updates, getRow: () => row };
};

describe("job scheduling", () => {
	it.each(["running", "completed"] as const)(
		"does not overwrite a Workflow that already reached %s",
		async (status) => {
			const state = harness();
			const result = await startJob(
				{
					jobs: state.jobs,
					confirmScheduled: async () => undefined,
					schedule: async (id, payload) => {
						expect(state.getRow()).toMatchObject({
							id,
							workflowInstanceId: id,
							status: "queued",
							request: params.request,
						});
						expect(payload).toEqual(params);
						await state.jobs.updateStatus(id, status);
						return { id };
					},
				},
				params,
				1,
			);
			expect(result).toBe("job_1");
			expect(state.getRow()?.status).toBe(status);
			expect(state.updates).toEqual([status]);
		},
	);

	it("recovers a create response lost after the Workflow accepted the instance", async () => {
		const state = harness();
		const confirmScheduled = vi.fn(async () => ({ status: "running" }));
		const id = await startJob(
			{
				jobs: state.jobs,
				confirmScheduled,
				schedule: async () => {
					await state.jobs.updateStatus("job_1", "running");
					throw new Error("response lost");
				},
			},
			params,
			1,
		);
		expect(id).toBe("job_1");
		expect(confirmScheduled).toHaveBeenCalledWith("job_1");
		expect(state.getRow()?.status).toBe("running");
	});

	it("retains the visible job when both creation and status lookup are uncertain", async () => {
		const state = harness();
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(
				startJob(
					{
						jobs: state.jobs,
						schedule: async () => {
							throw new Error("Workflow unavailable");
						},
						confirmScheduled: async () => {
							throw new Error("Lookup unavailable");
						},
					},
					params,
					1,
				),
			).rejects.toMatchObject({ code: "scheduling_unknown", status: 503, message: expect.stringContaining("job_1") });
			expect(state.getRow()?.status).toBe("queued");
		} finally {
			log.mockRestore();
		}
	});

	it("does not regress a running job when both create response and lookup are lost", async () => {
		const state = harness();
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		try {
			await expect(
				startJob(
					{
						jobs: state.jobs,
						schedule: async () => {
							await state.jobs.updateStatus("job_1", "running");
							throw new Error("Create response lost");
						},
						confirmScheduled: async () => {
							throw new Error("Lookup unavailable");
						},
					},
					params,
					1,
				),
			).rejects.toMatchObject({ code: "scheduling_unknown", status: 503 });
			expect(state.getRow()).toMatchObject({ status: "running", error: null });
		} finally {
			log.mockRestore();
		}
	});

	it("does not schedule when the initial row cannot be persisted", async () => {
		const state = harness();
		let scheduled = false;
		const failure = new Error("D1 unavailable");
		await expect(
			startJob(
				{
					jobs: {
						...state.jobs,
						createJob: async () => {
							throw failure;
						},
					},
					confirmScheduled: async () => undefined,
					schedule: async () => {
						scheduled = true;
					},
				},
				params,
				1,
			),
		).rejects.toBe(failure);
		expect(scheduled).toBe(false);
	});
});
