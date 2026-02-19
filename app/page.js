"use client";

import { useState, useRef } from "react";

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\s]+)/,
    /(?:youtu\.be\/)([^?\s]+)/,
    /(?:youtube\.com\/embed\/)([^?\s]+)/,
    /(?:youtube\.com\/shorts\/)([^?\s]+)/,
  ];
  for (const p of patterns) {
    const m = url.trim().match(p);
    if (m) return m[1];
  }
  return null;
}

function sanitizeFilename(title) {
  return title
    .replace(/[^a-zA-Z0-9\s\-_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 80);
}

function downloadTxt(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [input, setInput] = useState("");
  const [jobs, setJobs] = useState([]);
  const [processing, setProcessing] = useState(false);
  const textareaRef = useRef(null);

  const parseLinks = () => {
    const lines = input
      .split(/[\n,]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const parsed = [];
    for (const line of lines) {
      const videoId = extractVideoId(line);
      if (videoId) {
        parsed.push({ url: line, videoId, status: "pending", title: "", transcript: "", error: "" });
      }
    }
    return parsed;
  };

  const handleGo = async () => {
    const parsed = parseLinks();
    if (parsed.length === 0) return;
    if (parsed.length > 10) {
      alert("Please enter 10 or fewer links at a time.");
      return;
    }

    setJobs(parsed);
    setProcessing(true);

    for (let i = 0; i < parsed.length; i++) {
      setJobs((prev) => prev.map((j, idx) => (idx === i ? { ...j, status: "loading" } : j)));

      try {
        const resp = await fetch("/api/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: parsed[i].videoId }),
        });

        const data = await resp.json();

        if (!resp.ok || data.error) {
          setJobs((prev) =>
            prev.map((j, idx) =>
              idx === i ? { ...j, status: "error", error: data.error || "Failed" } : j
            )
          );
        } else {
          setJobs((prev) =>
            prev.map((j, idx) =>
              idx === i
                ? { ...j, status: "done", title: data.title, transcript: data.transcript }
                : j
            )
          );
        }
      } catch (err) {
        setJobs((prev) =>
          prev.map((j, idx) =>
            idx === i ? { ...j, status: "error", error: err.message } : j
          )
        );
      }
    }

    setProcessing(false);
  };

  const handleDownload = (job) => {
    const filename = sanitizeFilename(job.title || job.videoId) + ".txt";
    downloadTxt(filename, job.transcript);
  };

  const handleDownloadAll = () => {
    const done = jobs.filter((j) => j.status === "done");
    done.forEach((job, i) => {
      setTimeout(() => handleDownload(job), i * 300);
    });
  };

  const doneCount = jobs.filter((j) => j.status === "done").length;
  const linkCount = parseLinks().length;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0f0f0f",
        color: "#e8e8e8",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px" }}>
        {/* Header */}
        <h1
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: "#fff",
            margin: "0 0 6px",
          }}
        >
          YouTube Transcript Extractor
        </h1>
        <p style={{ color: "#888", fontSize: 14, margin: "0 0 32px" }}>
          Paste up to 10 YouTube links. Get a .txt file for each.
        </p>

        {/* Input */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"Paste YouTube links here, one per line...\n\nhttps://www.youtube.com/watch?v=abc123\nhttps://youtu.be/def456"}
          rows={6}
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #333",
            background: "#1a1a1a",
            color: "#fff",
            fontSize: 14,
            lineHeight: 1.6,
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#ff4444")}
          onBlur={(e) => (e.target.style.borderColor = "#333")}
        />

        {/* Action bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 14,
            marginBottom: 32,
          }}
        >
          <span style={{ fontSize: 13, color: "#666" }}>
            {linkCount > 0 ? `${linkCount} video${linkCount !== 1 ? "s" : ""} detected` : ""}
          </span>
          <button
            onClick={handleGo}
            disabled={processing || linkCount === 0}
            style={{
              padding: "10px 28px",
              borderRadius: 8,
              border: "none",
              background:
                processing || linkCount === 0
                  ? "#333"
                  : "linear-gradient(135deg, #ff4444, #cc0000)",
              color: processing || linkCount === 0 ? "#666" : "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: processing || linkCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            {processing ? "Processing..." : "Extract Transcripts"}
          </button>
        </div>

        {/* Results */}
        {jobs.length > 0 && (
          <div>
            {/* Download All button */}
            {doneCount > 1 && !processing && (
              <button
                onClick={handleDownloadAll}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#1a1a1a",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  marginBottom: 16,
                }}
              >
                Download All ({doneCount} files)
              </button>
            )}

            {/* Individual job rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {jobs.map((job, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    background: "#1a1a1a",
                    borderRadius: 10,
                    border: `1px solid ${
                      job.status === "error"
                        ? "#5c2020"
                        : job.status === "done"
                        ? "#1a3a1a"
                        : "#262626"
                    }`,
                  }}
                >
                  {/* Status indicator */}
                  <div style={{ flexShrink: 0, width: 24, textAlign: "center" }}>
                    {job.status === "pending" && (
                      <span style={{ color: "#555", fontSize: 16 }}>&#9679;</span>
                    )}
                    {job.status === "loading" && (
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          border: "2px solid #333",
                          borderTopColor: "#ff4444",
                          borderRadius: "50%",
                          animation: "spin 0.8s linear infinite",
                          margin: "0 auto",
                        }}
                      />
                    )}
                    {job.status === "done" && (
                      <span style={{ color: "#4ade80", fontSize: 18 }}>&#10003;</span>
                    )}
                    {job.status === "error" && (
                      <span style={{ color: "#ff6b6b", fontSize: 18 }}>&#10007;</span>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: job.status === "error" ? "#ff6b6b" : "#ddd",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {job.status === "done" && job.title
                        ? job.title
                        : job.status === "error"
                        ? job.error
                        : job.url}
                    </div>
                    {job.status === "done" && (
                      <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                        {job.transcript.split(/\s+/).length.toLocaleString()} words
                      </div>
                    )}
                  </div>

                  {/* Download button */}
                  {job.status === "done" && (
                    <button
                      onClick={() => handleDownload(job)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "1px solid #333",
                        background: "#252525",
                        color: "#ccc",
                        fontSize: 13,
                        cursor: "pointer",
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      Download .txt
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
