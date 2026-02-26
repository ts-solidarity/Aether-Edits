import React, { useEffect, useRef, useState } from "react";
import { getJobStatus } from "../api/jobs";

const STATUS_LABELS = {
  pending: "Waiting in queue...",
  downloading: "Downloading media...",
  converting: "Converting file...",
  completed: "Done!",
  failed: "Conversion failed",
};

export default function JobStatus({ jobId, onComplete, onFailed }) {
  const [job, setJob] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const data = await getJobStatus(jobId);
        setJob(data);
        if (data.status === "completed") {
          clearInterval(intervalRef.current);
          onComplete?.(data);
        } else if (data.status === "failed") {
          clearInterval(intervalRef.current);
          onFailed?.(data);
        }
      } catch {
        // Ignore poll errors
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => clearInterval(intervalRef.current);
  }, [jobId, onComplete, onFailed]);

  if (!job) return null;

  return (
    <div className="job-status">
      <div className="status-label">{STATUS_LABELS[job.status] || job.status}</div>
      <div className="progress-bar-container">
        <div
          className="progress-bar"
          style={{ width: `${job.progress_percent}%` }}
        />
      </div>
      <div className="progress-text">{job.progress_percent}%</div>
      {job.status === "failed" && job.error_message && (
        <div className="error-message">{job.error_message}</div>
      )}
    </div>
  );
}
