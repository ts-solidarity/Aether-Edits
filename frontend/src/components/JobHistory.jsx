import React from "react";
import { getDownloadUrl } from "../api/jobs";

export default function JobHistory({ history, onClear }) {
  if (!history || history.length === 0) return null;

  return (
    <div className="job-history">
      <div className="job-history__header">
        <h3>Recent Conversions</h3>
        <button className="job-history__clear" onClick={onClear} type="button">
          Clear
        </button>
      </div>
      <ul className="job-history__list">
        {history.map((entry) => (
          <li key={entry.id} className="job-history__item">
            <div className="job-history__info">
              <span className="job-history__name">
                {entry.name || "Conversion"}
              </span>
              <span className="job-history__meta">
                {entry.format?.toUpperCase()}
                {entry.size ? ` · ${(entry.size / (1024 * 1024)).toFixed(1)} MB` : ""}
              </span>
            </div>
            {entry.status === "completed" ? (
              <a
                href={getDownloadUrl(entry.id)}
                className="job-history__download"
                download
              >
                Download
              </a>
            ) : (
              <span className={`job-history__status job-history__status--${entry.status}`}>
                {entry.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
