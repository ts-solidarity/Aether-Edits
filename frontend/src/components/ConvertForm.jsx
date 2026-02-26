import React, { useState } from "react";
import FormatSelector from "./FormatSelector";

export default function ConvertForm({ onSubmit, disabled }) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("mp3");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit(url.trim(), format);
  };

  return (
    <form className="convert-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="url-input">Media URL</label>
        <input
          id="url-input"
          type="url"
          placeholder="Paste a YouTube, Vimeo, or direct media URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          disabled={disabled}
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="format-select">Output Format</label>
          <FormatSelector value={format} onChange={setFormat} />
        </div>
        <button type="submit" disabled={disabled || !url.trim()}>
          {disabled ? (
            <span className="btn-loading">
              <span className="spinner" />
              Converting...
            </span>
          ) : (
            "Convert"
          )}
        </button>
      </div>
    </form>
  );
}
