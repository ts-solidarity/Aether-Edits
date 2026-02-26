import React from "react";

export default function InputTabs({ activeTab, onTabChange, disabled }) {
  return (
    <div className="input-tabs">
      <button
        className={`input-tabs__tab ${activeTab === "url" ? "input-tabs__tab--active" : ""}`}
        onClick={() => onTabChange("url")}
        disabled={disabled}
        type="button"
      >
        URL
      </button>
      <button
        className={`input-tabs__tab ${activeTab === "upload" ? "input-tabs__tab--active" : ""}`}
        onClick={() => onTabChange("upload")}
        disabled={disabled}
        type="button"
      >
        Upload
      </button>
    </div>
  );
}
