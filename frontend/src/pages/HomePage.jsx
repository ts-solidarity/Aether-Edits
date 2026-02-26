import React, { useCallback, useState } from "react";
import { createJob, uploadFile } from "../api/jobs";
import ConvertForm from "../components/ConvertForm";
import DownloadLink from "../components/DownloadLink";
import FileUpload from "../components/FileUpload";
import InputTabs from "../components/InputTabs";
import JobHistory from "../components/JobHistory";
import JobStatus from "../components/JobStatus";
import useJobHistory from "../hooks/useJobHistory";
import FormatSelector from "../components/FormatSelector";

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("url");
  const [jobId, setJobId] = useState(null);
  const [outputFormat, setOutputFormat] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadFormat, setUploadFormat] = useState("mp3");

  const { history, addEntry, clearHistory } = useJobHistory();

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

  const handleUpload = async () => {
    if (!selectedFile) return;
    setError(null);
    setIsComplete(false);
    setIsProcessing(true);
    setOutputFormat(uploadFormat);
    setUploadProgress(0);

    try {
      const job = await uploadFile(selectedFile, uploadFormat, (e) => {
        if (e.total) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
      setJobId(job.id);
    } catch (err) {
      const message =
        err.response?.data?.detail || "Failed to upload file";
      setError(message);
      setIsProcessing(false);
    }
  };

  const handleComplete = useCallback(
    (job) => {
      setIsComplete(true);
      setIsProcessing(false);
      addEntry({
        id: job.id,
        name: selectedFile?.name || "URL conversion",
        format: outputFormat,
        size: job.file_size_bytes,
        status: "completed",
        date: new Date().toISOString(),
      });
    },
    [addEntry, selectedFile, outputFormat]
  );

  const handleFailed = useCallback(
    (job) => {
      setIsProcessing(false);
      addEntry({
        id: job.id,
        name: selectedFile?.name || "URL conversion",
        format: outputFormat,
        status: "failed",
        date: new Date().toISOString(),
      });
    },
    [addEntry, selectedFile, outputFormat]
  );

  const handleReset = () => {
    setJobId(null);
    setOutputFormat(null);
    setIsProcessing(false);
    setIsComplete(false);
    setError(null);
    setSelectedFile(null);
    setUploadProgress(0);
  };

  return (
    <div className="container">
      <header>
        <h1>Media Converter</h1>
        <p>Convert media from a URL or upload a file.</p>
      </header>

      <div className="card slide-in">
        <InputTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          disabled={isProcessing}
        />

        {activeTab === "url" ? (
          <ConvertForm onSubmit={handleSubmit} disabled={isProcessing} />
        ) : (
          <div className="upload-form">
            <FileUpload onFileSelect={setSelectedFile} disabled={isProcessing} />
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="upload-format">Output Format</label>
                <FormatSelector value={uploadFormat} onChange={setUploadFormat} />
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={isProcessing || !selectedFile}
                onClick={handleUpload}
              >
                {isProcessing ? (
                  <span className="btn-loading">
                    <span className="spinner" />
                    {uploadProgress < 100 ? `Uploading ${uploadProgress}%` : "Converting..."}
                  </span>
                ) : (
                  "Upload & Convert"
                )}
              </button>
            </div>
          </div>
        )}

        {error && <div className="error-message slide-in">{error}</div>}

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

      <JobHistory history={history} onClear={clearHistory} />
    </div>
  );
}
