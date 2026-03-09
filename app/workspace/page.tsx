"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import React from "react";

type Tab = "transcript" | "summary" | "quiz";
type ProcessingStatus = "idle" | "processing" | "ready" | "failed";

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const videoId = searchParams.get("v") ?? "";
  const apiBaseUrl = process.env.NEXT_PUBLIC_FLASK_API_URL ?? "http://127.0.0.1:5000";

  const [activeTab, setActiveTab] = useState<Tab>("transcript");
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("idle");
  const [processStats, setProcessStats] = useState<{ segments: number; chunks: number } | null>(null);

  useEffect(() => {
    if (!videoId) return;

    const controller = new AbortController();
    setIndexing(true);
    setIndexError(null);
    setProcessingStatus("processing");
    setProcessStats(null);

    fetch(`${apiBaseUrl}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || "Indexing failed");
        }

        const segments = Number.isFinite(data.segments) ? data.segments : 0;
        const chunks = Number.isFinite(data.chunks) ? data.chunks : 0;

        setProcessStats({ segments, chunks });
        setProcessingStatus("ready");
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setProcessingStatus("failed");
          setIndexError(
            err.message === "Failed to fetch"
              ? "Could not connect to the Flask API. Make sure it is running on port 5000."
              : err.message
          );
        }
      })
      .finally(() => setIndexing(false));

    return () => controller.abort();
  }, [videoId]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "transcript", label: "Transcript" },
    { key: "summary", label: "Summary" },
    { key: "quiz", label: "Quiz" },
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="flex items-center px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <h1 className="text-xl font-semibold text-gray-900">
          Tube<span className="text-blue-600">Tutor</span>
        </h1>
      </header>

      {/* Main content — stacks vertically on mobile, side-by-side on lg+ */}
      <main className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Left pane — Video player */}
        <section className="w-full lg:w-[60%] bg-black flex items-center justify-center p-4 lg:p-6">
          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <iframe
              className="absolute inset-0 w-full h-full rounded-lg"
              src={`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`}
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </section>

        {/* Right pane — AI Study Hub */}
        <section className="w-full lg:w-[40%] flex flex-col min-h-0 bg-white border-l border-gray-200">
          {/* Hub header + tabs */}
          <div className="shrink-0 border-b border-gray-200">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                AI Study Hub
              </h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                  processingStatus === "processing"
                    ? "bg-blue-100 text-blue-700"
                    : processingStatus === "ready"
                      ? "bg-emerald-100 text-emerald-700"
                      : processingStatus === "failed"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                }`}
              >
                {processingStatus === "processing"
                  ? "Processing"
                  : processingStatus === "ready"
                    ? "Ready"
                    : processingStatus === "failed"
                      ? "Failed"
                      : "Waiting"}
              </span>
            </div>
            <nav className="flex px-5 gap-1" aria-label="Study hub tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                    activeTab === tab.key
                      ? "bg-blue-50 text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === "transcript" && (
              <TranscriptPanel
                indexing={indexing}
                processingStatus={processingStatus}
                indexError={indexError}
                processStats={processStats}
              />
            )}
            {activeTab === "summary" && <SummaryPanel />}
            {activeTab === "quiz" && <QuizPanel />}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense>
      <WorkspaceContent />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab panels                                                         */
/* ------------------------------------------------------------------ */

function TranscriptPanel({
  indexing,
  processingStatus,
  indexError,
  processStats,
}: {
  indexing: boolean;
  processingStatus: ProcessingStatus;
  indexError: string | null;
  processStats: { segments: number; chunks: number } | null;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-900">Transcript</h3>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
        {processingStatus === "processing" && (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>Building your study guide...</span>
            </div>
            <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
              <div className="h-full w-1/2 bg-blue-500 animate-pulse" />
            </div>
          </>
        )}

        {processingStatus === "ready" && (
          <p className="text-sm text-emerald-700">
            Video processed. Indexed {processStats?.segments ?? 0} transcript segments into {processStats?.chunks ?? 0} chunks.
          </p>
        )}

        {processingStatus === "failed" && (
          <p className="text-sm text-red-600">{indexError ?? "Failed to process video."}</p>
        )}

        {processingStatus === "idle" && !indexing && (
          <p className="text-sm text-gray-500">
            The full video transcript will appear here once the video is processed.
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryPanel() {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-900">Summary</h3>
      <p className="text-sm text-gray-500">
        An AI-generated summary of the video will appear here.
      </p>
    </div>
  );
}

function QuizPanel() {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-900">Quiz</h3>
      <p className="text-sm text-gray-500">
        AI-generated quiz questions based on the video content will appear here.
      </p>
    </div>
  );
}
