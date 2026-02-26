import React, { useCallback, useState } from "react";
import { createJob } from "../api/jobs";
import ConvertForm from "../components/ConvertForm";
import DownloadLink from "../components/DownloadLink";
import JobStatus from "../components/JobStatus";

export default function HomePage() {
  const [jobId, setJobId] = useState(null);
  const [outputFormat, setOutputFormat] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (url, format) => {
    setError(null);
    setIsComplete(false);
    setIsProcessing(true);
    setOutputFormat(format);

    try {
      const job = await createJob(url, format);
      setJobId(job.id);
    } catch (err) {
      const message =
        err.response?.data?.detail || "Failed to submit conversion job";
      setError(message);
      setIsProcessing(false);
    }
  };

  const handleComplete = useCallback(() => {
    setIsComplete(true);
    setIsProcessing(false);
  }, []);

  const handleFailed = useCallback(() => {
    setIsProcessing(false);
  }, []);

  const handleReset = () => {
    setJobId(null);
    setOutputFormat(null);
    setIsProcessing(false);
    setIsComplete(false);
    setError(null);
  };

  return (
    <div className="container">
      <header>
        <h1>Media Converter</h1>
        <p>Paste a URL, pick a format, and convert.</p>
      </header>

      <div className="card">
        <ConvertForm onSubmit={handleSubmit} disabled={isProcessing} />

        {error && <div className="error-message">{error}</div>}

        {jobId && (
          <JobStatus
            jobId={jobId}
            onComplete={handleComplete}
            onFailed={handleFailed}
          />
        )}

        {isComplete && (
          <DownloadLink jobId={jobId} format={outputFormat} />
        )}

        {(isComplete || error) && (
          <button className="reset-button" onClick={handleReset}>
            Convert Another
          </button>
        )}
      </div>
    </div>
  );
}
