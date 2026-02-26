import React from "react";
import { getDownloadUrl } from "../api/jobs";

export default function DownloadLink({ jobId, format }) {
  if (!jobId) return null;

  return (
    <div className="download-section">
      <a
        href={getDownloadUrl(jobId)}
        className="download-button"
        download={`converted.${format}`}
      >
        Download .{format} File
      </a>
    </div>
  );
}
