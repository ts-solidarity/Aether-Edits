import { useEffect, useRef, useState } from "react";
import { getStreamUrl } from "../api/jobs";

export default function useJobStream(jobId) {
  const [job, setJob] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;

    const es = new EventSource(getStreamUrl(jobId));
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setJob(data);
        if (data.status === "completed" || data.status === "failed" || data.error) {
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [jobId]);

  return job;
}
