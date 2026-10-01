import { PlatformError } from "../core/types";
import type { JobsRepo } from "./repo";
import type { JobParams } from "./workflow";

interface StartJobDeps {
	jobs: Pick<JobsRepo, "createJob" | "updateStatus">;
	schedule: (id: string, params: JobParams) => Promise<unknown>;
	/** Must query instance status, not merely construct a local handle. */
	confirmScheduled: (id: string) => Promise<unknown>;
}

/** Persist the caller-chosen instance id before the Workflow can start updating its row. */
export const startJob = async (deps: StartJobDeps, params: JobParams, total: number): Promise<string> => {
	await deps.jobs.createJob({
		id: params.jobId,
		userId: params.userId,
		type: params.type,
		request: params.request,
		total,
		workflowInstanceId: params.jobId,
	});

	try {
		await deps.schedule(params.jobId, params);
	} catch (error) {
		try {
			await deps.confirmScheduled(params.jobId);
		} catch (lookupError) {
			console.error("job_scheduling_unknown", { jobId: params.jobId, error, lookupError });
			try {
				await deps.jobs.updateStatus(params.jobId, "queued", { error: "scheduling_unknown" });
			} catch (recordError) {
				// The caller still needs the already-created job id when D1 is unavailable.
				console.error("job_scheduling_error_record_failed", { jobId: params.jobId, error: recordError });
			}
			throw new PlatformError(
				"scheduling_unknown",
				`Scheduling could not be confirmed for job ${params.jobId}. Check this job before submitting again.`,
				503,
			);
		}
	}

	// The Workflow owns status from this point. A late queued write could undo running,
	// and a failed bookkeeping write could incorrectly mark an accepted job as failed.
	return params.jobId;
};
