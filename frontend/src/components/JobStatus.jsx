import React from "react";
import useJobStream from "../hooks/useJobStream";

const STATUS_LABELS = {
  pending: "Waiting in queue...",
  downloading: "Downloading media...",
  converting: "Converting file...",
  completed: "Done!",
  failed: "Conversion failed",
};

export default function JobStatus({ jobId, onComplete, onFailed }) {
  const job = useJobStream(jobId);
  const status = job?.status;

  React.useEffect(() => {
    if (!job) return;
    if (status === "completed") onComplete?.(job);
    else if (status === "failed") onFailed?.(job);
  }, [status, job, onComplete, onFailed]);

  if (!job) return null;

  const isComplete = job.status === "completed";
  const isFailed = job.status === "failed";

  return (
    <div className={`job-status ${isComplete ? "job-status--complete" : ""} ${isFailed ? "job-status--failed" : ""}`}>
      <div className="status-label">{STATUS_LABELS[job.status] || job.status}</div>
      <div className="progress-bar-container">
        <div
          className={`progress-bar ${isComplete ? "progress-bar--complete" : ""}`}
          style={{ width: `${job.progress_percent}%` }}
        />
      </div>
      <div className="progress-text">{job.progress_percent}%</div>
      {isFailed && job.error_message && (
        <div className="error-message">{job.error_message}</div>
      )}
    </div>
  );
}
