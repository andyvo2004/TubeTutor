"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import React from "react";
import InteractiveQuiz from "@/components/InteractiveQuiz";

type Tab = "transcript" | "summary" | "quiz";
type ProcessingStatus = "idle" | "processing" | "ready" | "failed";
type ChatMessage = { role: "user" | "ai"; content: string };

function WorkspaceContent() {
  const searchParams = useSearchParams();
  const videoId = searchParams.get("v") ?? "";
  const apiBaseUrl = process.env.NEXT_PUBLIC_FLASK_API_URL ?? "http://127.0.0.1:5000";

  const [activeTab, setActiveTab] = useState<Tab>("transcript");
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("idle");
  const [processStats, setProcessStats] = useState<{ segments: number; chunks: number } | null>(null);
  const [quizData, setQuizData] = useState<any>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

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

  // Generate quiz in background after transcript is processed
  useEffect(() => {
    if (!videoId || processingStatus !== "ready") return;

    const generateQuiz = async () => {
      setQuizLoading(true);
      setQuizError(null);

      try {
        const response = await fetch(`${apiBaseUrl}/generate_quiz`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            video_id: videoId,
            quiz_nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const errorMsg = data.error || `Server error (${response.status})`;
          throw new Error(errorMsg);
        }

        if (!data.quiz || !data.quiz.questions || !Array.isArray(data.quiz.questions) || data.quiz.questions.length === 0) {
          throw new Error("Invalid quiz format received from server.");
        }

        setQuizData(data.quiz.questions);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate quiz. Please try again.";
        setQuizError(message);
        console.error("Quiz generation error:", err);
      } finally {
        setQuizLoading(false);
      }
    };

    generateQuiz();
  }, [videoId, processingStatus, apiBaseUrl]);

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
            {activeTab === "summary" && <SummaryPanel videoId={videoId} apiBaseUrl={apiBaseUrl} />}
            {activeTab === "quiz" && (
              <QuizPanel
                videoId={videoId}
                apiBaseUrl={apiBaseUrl}
                quizData={quizData}
                quizLoading={quizLoading}
                quizError={quizError}
                onRegenerate={() => {
                  setQuizData(null);
                  setQuizError(null);
                  setQuizLoading(true);
                  // Trigger quiz generation
                  fetch(`${apiBaseUrl}/generate_quiz`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    cache: "no-store",
                    body: JSON.stringify({
                      video_id: videoId,
                      quiz_nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    }),
                  })
                    .then((res) => res.json())
                    .then((data) => {
                      if (data.quiz?.questions) {
                        setQuizData(data.quiz.questions);
                      } else {
                        throw new Error("Invalid quiz format");
                      }
                    })
                    .catch((err) => {
                      const message = err instanceof Error ? err.message : "Failed to generate quiz";
                      setQuizError(message);
                      console.error("Quiz regeneration error:", err);
                    })
                    .finally(() => setQuizLoading(false));
                }}
              />
            )}
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

function SummaryPanel({ videoId, apiBaseUrl }: { videoId: string; apiBaseUrl: string }) {
  return (
    <div className="space-y-3 h-full min-h-0">
      <h3 className="text-lg font-semibold text-gray-900">Summary</h3>
      <ChatAssistant videoId={videoId} apiBaseUrl={apiBaseUrl} />
    </div>
  );
}

function QuizPanel({
  videoId,
  apiBaseUrl,
  quizData,
  quizLoading,
  quizError,
  onRegenerate,
}: {
  videoId: string;
  apiBaseUrl: string;
  quizData: any;
  quizLoading: boolean;
  quizError: string | null;
  onRegenerate: () => void;
}) {
  if (quizLoading) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Quiz</h3>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
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
            <span>Generating your quiz...</span>
          </div>
          <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
            <div className="h-full w-1/2 bg-blue-500 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (quizError) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Quiz</h3>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm text-red-600">{quizError}</p>
          <p className="text-xs text-red-500">
            Make sure the transcript has been processed first before generating a quiz.
          </p>
          <button
            onClick={onRegenerate}
            className="mt-3 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!quizData || quizData.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Quiz</h3>
        <p className="text-sm text-gray-500">
          AI-generated quiz questions based on the video content will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full flex flex-col -m-5">
      <div className="flex items-center justify-between gap-3 px-5 pt-3">
        <h3 className="text-lg font-semibold text-gray-900">Quiz</h3>
        <button
          onClick={onRegenerate}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 px-3 py-1 rounded-full hover:bg-blue-50 transition-colors"
          title="Generate a new quiz"
        >
          🔄 New Quiz
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <InteractiveQuiz quizData={quizData} />
      </div>
    </div>
  );
}

function ChatAssistant({ videoId, apiBaseUrl }: { videoId: string; apiBaseUrl: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || isLoading) {
      return;
    }

    if (!videoId) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: "Missing video_id. Open a video workspace first." },
      ]);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: trimmedQuestion }]);
    setQuestion("");
    setIsLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: videoId,
          question: trimmedQuestion,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to get an answer from the assistant.");
      }

      const answer =
        typeof data.answer === "string" && data.answer.trim()
          ? data.answer
          : "I cannot find the answer in this video.";

      setMessages((prev) => [...prev, { role: "ai", content: answer }]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to get an answer from the assistant.";

      setMessages((prev) => [...prev, { role: "ai", content: message }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full min-h-0 rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">
            Ask any question about this video. Your chat history will appear here.
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              message.role === "user"
                ? "ml-auto bg-blue-600 text-white"
                : "mr-auto bg-white text-gray-800 border border-gray-200"
            }`}
          >
            {message.content}
          </div>
        ))}

        {isLoading && (
          <div className="mr-auto bg-white text-gray-700 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm">
            Thinking...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-gray-200 bg-white p-3 sticky bottom-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about this video..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !question.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
