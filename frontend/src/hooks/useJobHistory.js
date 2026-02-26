import { useCallback, useState } from "react";

const STORAGE_KEY = "cloudvideo_job_history";
const MAX_ENTRIES = 20;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export default function useJobHistory() {
  const [history, setHistory] = useState(loadHistory);

  const addEntry = useCallback((entry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((e) => e.id !== entry.id)].slice(
        0,
        MAX_ENTRIES
      );
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { history, addEntry, clearHistory };
}
