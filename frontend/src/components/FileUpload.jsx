import React, { useCallback, useRef, useState } from "react";

export default function FileUpload({ onFileSelect, disabled }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const inputRef = useRef(null);

  const handleFile = useCallback(
    (file) => {
      if (file) {
        setSelectedFile(file);
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className={`drop-zone ${dragActive ? "drop-zone--active" : ""} ${disabled ? "drop-zone--disabled" : ""}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={disabled ? undefined : handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        onChange={handleChange}
        disabled={disabled}
        style={{ display: "none" }}
      />
      {selectedFile ? (
        <div className="drop-zone__preview">
          <span className="drop-zone__filename">{selectedFile.name}</span>
          <span className="drop-zone__size">{formatSize(selectedFile.size)}</span>
        </div>
      ) : (
        <div className="drop-zone__prompt">
          <span className="drop-zone__icon">+</span>
          <span>Drop a file here or click to browse</span>
          <span className="drop-zone__hint">Max 500 MB</span>
        </div>
      )}
    </div>
  );
}
