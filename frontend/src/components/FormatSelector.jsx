import React, { useEffect, useState } from "react";
import { getFormats } from "../api/jobs";

export default function FormatSelector({ value, onChange }) {
  const [formats, setFormats] = useState(null);

  useEffect(() => {
    getFormats().then(setFormats).catch(() => {
      // Fallback if API is unreachable
      setFormats({
        video: [
          { value: "mp4", label: "MP4" },
          { value: "webm", label: "WebM" },
          { value: "mkv", label: "MKV" },
        ],
        audio: [
          { value: "mp3", label: "MP3" },
          { value: "aac", label: "AAC" },
          { value: "wav", label: "WAV" },
          { value: "flac", label: "FLAC" },
        ],
      });
    });
  }, []);

  if (!formats) return <select disabled><option>Loading...</option></select>;

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Video">
        {formats.video.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </optgroup>
      <optgroup label="Audio">
        {formats.audio.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </optgroup>
    </select>
  );
}
