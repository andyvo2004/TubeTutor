"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import InteractiveQuiz from "@/components/InteractiveQuiz";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

type Tab = "transcript" | "summary" | "chat" | "quiz";
type ProcessingStatus = "idle" | "processing" | "ready" | "failed";
type ThemeMode = "light" | "dark";
type TranscriptSegment = { text?: string; start?: number; duration?: number };
type ChatMessage = { role: "user" | "ai"; content: string };

function normalizeStudyGuideMarkdown(raw: string): string {
  if (!raw) {
    return "";
  }

  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br />")
    .replace(/<br\s*\/?\s*>/gi, "<br />");
}

const markdownDisallowedElements = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "link",
];

function formatPdfExportTimestamp(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function collectPdfBreakpoints(exportNode: HTMLElement, canvasHeightPx: number): number[] {
  const blockNodes = Array.from(exportNode.querySelectorAll<HTMLElement>("[data-pdf-block='true']"));
  const rowNodes = Array.from(exportNode.querySelectorAll<HTMLElement>("[data-pdf-row='true']"));
  if (blockNodes.length === 0) {
    return [];
  }

  const domHeight = Math.max(1, exportNode.scrollHeight);
  const pxScale = canvasHeightPx / domHeight;
  const rootRect = exportNode.getBoundingClientRect();
  const points = new Set<number>();

  const addPoint = (rawPoint: number) => {
    const clamped = Math.max(1, Math.min(canvasHeightPx - 1, rawPoint));
    if (Number.isFinite(clamped)) {
      points.add(clamped);
    }
  };

  for (const node of blockNodes) {
    const rect = node.getBoundingClientRect();
    const topDomPx = Math.max(0, rect.top - rootRect.top);
    const bottomDomPx = Math.max(0, rect.bottom - rootRect.top);
    const top = Math.floor(topDomPx * pxScale);
    const bottom = Math.floor(bottomDomPx * pxScale);

    if (top > 0) {
      addPoint(top);
    }
    if (bottom > 0) {
      addPoint(bottom);
    }
  }

  for (const row of rowNodes) {
    const rect = row.getBoundingClientRect();
    const rowTopDomPx = Math.max(0, rect.top - rootRect.top);
    const rowBottomDomPx = Math.max(0, rect.bottom - rootRect.top);
    const rowTop = Math.floor(rowTopDomPx * pxScale);
    const rowBottom = Math.floor(rowBottomDomPx * pxScale);

    if (rowTop > 0) {
      addPoint(rowTop);
      addPoint(rowTop - 2);
    }
    if (rowBottom > 0) {
      addPoint(rowBottom);
    }
  }

  return Array.from(points).sort((a, b) => a - b);
}

function chooseNextSliceHeight(
  yOffsetPx: number,
  pageCanvasHeightPx: number,
  canvasHeightPx: number,
  breakpointsPx: number[]
): number {
  const remaining = canvasHeightPx - yOffsetPx;
  if (remaining <= pageCanvasHeightPx) {
    return remaining;
  }

  const target = yOffsetPx + pageCanvasHeightPx;
  const minSliceHeight = Math.max(120, Math.floor(pageCanvasHeightPx * 0.45));
  const maxStretchHeight = Math.floor(pageCanvasHeightPx * 1.2);

  let previousBreakpoint = -1;
  let nextBreakpoint = -1;

  for (const breakpoint of breakpointsPx) {
    if (breakpoint <= yOffsetPx + minSliceHeight) {
      continue;
    }
    if (breakpoint <= target) {
      previousBreakpoint = breakpoint;
      continue;
    }
    nextBreakpoint = breakpoint;
    break;
  }

  if (previousBreakpoint > 0) {
    const candidate = previousBreakpoint - yOffsetPx;
    if (candidate >= minSliceHeight) {
      return candidate;
    }
  }

  if (nextBreakpoint > 0) {
    const stretched = nextBreakpoint - yOffsetPx;
    if (stretched > minSliceHeight && stretched <= maxStretchHeight) {
      return stretched;
    }
  }

  return pageCanvasHeightPx;
}

function StudyGuideMarkdown({ content }: { content: string }) {
  const normalizedContent = normalizeStudyGuideMarkdown(content);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, [rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "#374151" }]]}
      disallowedElements={markdownDisallowedElements}
      unwrapDisallowed
      components={{
        h1: ({ children }) => (
          <h1
            data-pdf-block="true"
            style={{ fontSize: "1.55rem", fontWeight: 700, lineHeight: 1.3, margin: "1.2rem 0 0.6rem", color: "#0f172a" }}
          >
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2
            data-pdf-block="true"
            style={{ fontSize: "1.28rem", fontWeight: 700, lineHeight: 1.35, margin: "1rem 0 0.55rem", color: "#111827" }}
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3
            data-pdf-block="true"
            style={{ fontSize: "1.08rem", fontWeight: 700, lineHeight: 1.4, margin: "0.85rem 0 0.45rem", color: "#1f2937" }}
          >
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p data-pdf-block="true" style={{ margin: "0.62rem 0", lineHeight: 1.75, color: "#111827" }}>
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul
            data-pdf-block="true"
            style={{ margin: "0.56rem 0", paddingLeft: "1.25rem", listStyleType: "disc", lineHeight: 1.7 }}
          >
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol
            data-pdf-block="true"
            style={{ margin: "0.56rem 0", paddingLeft: "1.25rem", listStyleType: "decimal", lineHeight: 1.7 }}
          >
            {children}
          </ol>
        ),
        li: ({ children }) => <li style={{ margin: "0.25rem 0" }}>{children}</li>,
        pre: ({ children }) => (
          <pre
            data-pdf-block="true"
            style={{
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              padding: "0.7rem 0.8rem",
              overflowX: "auto",
              margin: "0.7rem 0",
            }}
          >
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div data-pdf-block="true" style={{ overflowX: "auto", margin: "0.75rem 0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "420px", tableLayout: "fixed" }}>{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead style={{ backgroundColor: "#f1f5f9" }}>{children}</thead>,
        tr: ({ children }) => <tr data-pdf-row="true">{children}</tr>,
        th: ({ children }) => (
          <th style={{ border: "1px solid #d1d5db", padding: "0.55rem 0.65rem", textAlign: "left", fontWeight: 700, wordBreak: "break-word", overflowWrap: "anywhere" }}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td style={{ border: "1px solid #d1d5db", padding: "0.48rem 0.65rem", verticalAlign: "top", wordBreak: "break-word", overflowWrap: "anywhere" }}>
            {children}
          </td>
        ),
        code: ({ children, className }) => (
          <code
            className={className}
            style={{
              backgroundColor: "#f3f4f6",
              borderRadius: "4px",
              padding: "0.08rem 0.32rem",
              fontSize: "0.9em",
              fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
            }}
          >
            {children}
          </code>
        ),
      }}
    >
      {normalizedContent}
    </ReactMarkdown>
  );
}

function ChatMarkdown({ content }: { content: string }) {
  const normalized = normalizeStudyGuideMarkdown(content);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, [rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "#374151" }]]}
      disallowedElements={markdownDisallowedElements}
      unwrapDisallowed
      components={{
        p: ({ children }) => <p style={{ margin: "0.35rem 0", lineHeight: 1.6 }}>{children}</p>,
        ul: ({ children }) => <ul style={{ margin: "0.35rem 0", paddingLeft: "1.1rem", listStyleType: "disc" }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: "0.35rem 0", paddingLeft: "1.1rem", listStyleType: "decimal" }}>{children}</ol>,
        li: ({ children }) => <li style={{ margin: "0.2rem 0" }}>{children}</li>,
        table: ({ children }) => (
          <div style={{ overflowX: "auto", margin: "0.55rem 0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "360px" }}>{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead style={{ backgroundColor: "#f8fafc" }}>{children}</thead>,
        th: ({ children }) => (
          <th style={{ border: "1px solid #d1d5db", padding: "0.4rem 0.5rem", textAlign: "left", fontWeight: 700 }}>
            {children}
          </th>
        ),
        td: ({ children }) => <td style={{ border: "1px solid #d1d5db", padding: "0.35rem 0.5rem", verticalAlign: "top" }}>{children}</td>,
        code: ({ children }) => (
          <code style={{ backgroundColor: "#f3f4f6", borderRadius: "4px", padding: "0.05rem 0.3rem", fontSize: "0.9em" }}>
            {children}
          </code>
        ),
      }}
    >
      {normalized}
    </ReactMarkdown>
  );
}

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
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [isTranscriptLoading, setIsTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatQuestion, setChatQuestion] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [themeReady, setThemeReady] = useState(false);
  const pdfContentRef = useRef<HTMLDivElement | null>(null);
  const hasGeneratedSummary = summaryText.trim().length > 0;
  const normalizedSummary = normalizeStudyGuideMarkdown(summaryText);
  const pdfPreviewTimestamp = formatPdfExportTimestamp(new Date());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedTheme = window.localStorage.getItem("tubeTutorTheme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      setThemeReady(true);
      return;
    }

    setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !themeReady) {
      return;
    }

    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("tubeTutorTheme", theme);
  }, [theme, themeReady]);

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
  }, [videoId, apiBaseUrl]);

  useEffect(() => {
    if (!videoId) {
      setTranscriptSegments([]);
      setTranscriptError(null);
      setIsTranscriptLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsTranscriptLoading(true);
    setTranscriptError(null);

    fetch(`${apiBaseUrl}/transcript?video_id=${encodeURIComponent(videoId)}`, {
      method: "GET",
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const baseMessage = data.error || "Failed to fetch transcript.";
          const details = typeof data.details === "string" && data.details.trim() ? ` ${data.details}` : "";
          throw new Error(`${baseMessage}${details}`.trim());
        }

        const segments = Array.isArray(data.transcript) ? data.transcript : [];
        setTranscriptSegments(segments);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          const message = err instanceof Error ? err.message : "Failed to fetch transcript.";
          setTranscriptError(message);
          setTranscriptSegments([]);
        }
      })
      .finally(() => setIsTranscriptLoading(false));

    return () => controller.abort();
  }, [videoId, apiBaseUrl]);

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

  useEffect(() => {
    setSummaryText("");
    setSummaryError(null);
    setIsGeneratingSummary(false);
    setChatMessages([]);
    setChatQuestion("");
    setIsChatLoading(false);
  }, [videoId, apiBaseUrl]);

  const generateSummary = async () => {
    if (!videoId || isGeneratingSummary) {
      return;
    }

    setSummaryError(null);
    setSummaryText("");
    setIsGeneratingSummary(true);

    try {
      const response = await fetch(`${apiBaseUrl}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ video_id: videoId }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const baseMessage = data.error || "Failed to generate study guide.";
        const details = typeof data.details === "string" && data.details.trim() ? ` ${data.details}` : "";
        throw new Error(`${baseMessage}${details}`.trim());
      }

      const summary =
        typeof data.summary === "string" && data.summary.trim()
          ? data.summary
          : "No summary was returned by the server.";

      setSummaryText(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate study guide.";
      setSummaryError(message);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const downloadStudyGuidePdf = async () => {
    if (isDownloadingPdf || !hasGeneratedSummary) {
      return;
    }

    const exportNode = pdfContentRef.current;
    if (!exportNode) {
      setPdfError("Could not prepare PDF content. Please try again.");
      return;
    }

    setPdfError(null);
    setIsDownloadingPdf(true);

    let prevLeft = "";
    let prevTop = "";
    let prevOpacity = "";
    let prevZIndex = "";
    let prevPointerEvents = "";

    try {
      const { jsPDF } = await import("jspdf");
      const html2canvasModule = await import("html2canvas");
      const html2canvas = html2canvasModule.default;

      // Temporarily bring export node into the render area so html2canvas can capture it.
      prevLeft = exportNode.style.left;
      prevTop = exportNode.style.top;
      prevOpacity = exportNode.style.opacity;
      prevZIndex = exportNode.style.zIndex;
      prevPointerEvents = exportNode.style.pointerEvents;
      exportNode.style.left = "0";
      exportNode.style.top = "0";
      exportNode.style.opacity = "1";
      exportNode.style.zIndex = "99999";
      exportNode.style.pointerEvents = "none";

      const filename = `tube-tutor-study-guide-${videoId || "export"}.pdf`;

      if (typeof document !== "undefined" && "fonts" in document) {
        await (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
      }

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const exportedAt = formatPdfExportTimestamp(new Date());
      const guideTitle = "TubeTutor Study Guide";
      const guideSubtitle = videoId ? `Video ID: ${videoId}` : "Generated Study Guide";

      const pdf = new jsPDF({
        unit: "pt",
        format: "letter",
        orientation: "portrait",
        compress: true,
      });

      const canvas = await html2canvas(exportNode, {
        scale: 3,
        useCORS: true,
        backgroundColor: "#ffffff",
        foreignObjectRendering: true,
        logging: false,
      });

      const pageWidthPt = pdf.internal.pageSize.getWidth();
      const pageHeightPt = pdf.internal.pageSize.getHeight();
      const horizontalMarginPt = 48;
      const headerBandPt = 44;
      const footerBandPt = 28;
      const topMarginPt = 24;
      const bottomMarginPt = 20;
      const contentXPt = horizontalMarginPt;
      const contentYPt = topMarginPt + headerBandPt;
      const contentWidthPt = pageWidthPt - horizontalMarginPt * 2;
      const contentHeightPt = pageHeightPt - contentYPt - (bottomMarginPt + footerBandPt);

      const pageCanvasHeightPx = Math.max(
        1,
        Math.floor((contentHeightPt * canvas.width) / contentWidthPt)
      );
      const breakpointsPx = collectPdfBreakpoints(exportNode, canvas.height);
      const seamOverlapPx = 2;

      let yOffsetPx = 0;
      let pageIndex = 0;
      while (yOffsetPx < canvas.height) {
        const sliceHeightPx = Math.max(
          1,
          chooseNextSliceHeight(yOffsetPx, pageCanvasHeightPx, canvas.height, breakpointsPx)
        );
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) {
          throw new Error("Failed to create canvas context for PDF page rendering.");
        }

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(
          canvas,
          0,
          yOffsetPx,
          canvas.width,
          sliceHeightPx,
          0,
          0,
          pageCanvas.width,
          pageCanvas.height
        );

        const imgData = pageCanvas.toDataURL("image/png");
        const renderedHeightPt = (sliceHeightPx * contentWidthPt) / canvas.width;

        if (pageIndex > 0) {
          pdf.addPage();
        }
        pdf.addImage(imgData, "PNG", contentXPt, contentYPt, contentWidthPt, renderedHeightPt);

        const hasMoreContent = yOffsetPx + sliceHeightPx < canvas.height;
        const advancePx = hasMoreContent ? Math.max(1, sliceHeightPx - seamOverlapPx) : sliceHeightPx;
        yOffsetPx += advancePx;
        pageIndex += 1;
      }

      const totalPages = pdf.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        pdf.setPage(page);

        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.8);
        pdf.line(horizontalMarginPt, topMarginPt + headerBandPt - 8, pageWidthPt - horizontalMarginPt, topMarginPt + headerBandPt - 8);

        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(15, 23, 42);
        pdf.setFontSize(11.5);
        pdf.text(guideTitle, horizontalMarginPt, topMarginPt + 8);

        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(75, 85, 99);
        pdf.setFontSize(9.5);
        pdf.text(guideSubtitle, horizontalMarginPt, topMarginPt + 22);

        const timestampWidth = pdf.getTextWidth(exportedAt);
        pdf.text(exportedAt, pageWidthPt - horizontalMarginPt - timestampWidth, topMarginPt + 22);

        const footerLineY = pageHeightPt - bottomMarginPt - footerBandPt + 3;
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.8);
        pdf.line(horizontalMarginPt, footerLineY, pageWidthPt - horizontalMarginPt, footerLineY);

        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(9);
        const pageText = `Page ${page} of ${totalPages}`;
        const pageTextWidth = pdf.getTextWidth(pageText);
        pdf.text(pageText, pageWidthPt - horizontalMarginPt - pageTextWidth, pageHeightPt - bottomMarginPt);
      }

      pdf.save(filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to export PDF.";
      setPdfError(message);
    } finally {
      exportNode.style.left = prevLeft;
      exportNode.style.top = prevTop;
      exportNode.style.opacity = prevOpacity;
      exportNode.style.zIndex = prevZIndex;
      exportNode.style.pointerEvents = prevPointerEvents;
      setIsDownloadingPdf(false);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "transcript", label: "Transcript" },
    { key: "summary", label: "Study Guide" },
    { key: "chat", label: "Chat" },
    { key: "quiz", label: "Quiz" },
  ];

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 transition-colors dark:bg-[#101214] dark:text-slate-100">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-700 dark:bg-[#262626]">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="text-xl font-semibold text-[#262626] transition-opacity hover:opacity-85 dark:text-slate-100">
            Tube<span className="text-[#b3a369]">Tutor</span>
          </Link>
          <button
            type="button"
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                theme === "dark" ? "bg-[#b3a369]" : "bg-[#262626]"
              }`}
            />
            {theme === "dark" ? "Dark" : "Light"}
          </button>
        </div>
      </header>

      {/* Main content — stacks vertically on mobile, side-by-side on lg+ */}
      <main className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Left pane — Video player */}
        <section className="flex w-full items-center justify-center bg-black p-4 lg:w-[60%] lg:p-6">
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
        <section className="flex w-full min-h-0 flex-col border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-[#181a1d] lg:w-[40%]">
          {/* Hub header + tabs */}
          <div className="shrink-0 border-b border-slate-200 dark:border-slate-700">
            <div className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                AI Study Hub
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadStudyGuidePdf}
                  disabled={isDownloadingPdf || !hasGeneratedSummary}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  title="Download generated study guide as PDF"
                >
                  {isDownloadingPdf ? "Preparing PDF..." : "Download as PDF"}
                </button>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                    processingStatus === "processing"
                      ? "bg-gtGold/25 text-gtNavy dark:bg-gtGold/20 dark:text-gtGold"
                      : processingStatus === "ready"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : processingStatus === "failed"
                          ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200"
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
            </div>
            {pdfError && (
              <p className="px-5 pb-2 text-xs text-red-600">{pdfError}</p>
            )}
            <nav className="flex px-5 gap-1" aria-label="Study hub tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                    activeTab === tab.key
                      ? "border-b-2 border-gtGold bg-gtGold/20 text-gtNavy dark:bg-gtGold/25 dark:text-gtGold"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
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
                transcriptSegments={transcriptSegments}
                isTranscriptLoading={isTranscriptLoading}
                transcriptError={transcriptError}
              />
            )}
            {activeTab === "summary" && (
              <SummaryPanel
                summaryText={summaryText}
                isGeneratingSummary={isGeneratingSummary}
                summaryError={summaryError}
                onGenerateSummary={generateSummary}
                disabled={!videoId}
              />
            )}
            {activeTab === "chat" && (
              <ChatPanel
                videoId={videoId}
                apiBaseUrl={apiBaseUrl}
                messages={chatMessages}
                setMessages={setChatMessages}
                question={chatQuestion}
                setQuestion={setChatQuestion}
                isLoading={isChatLoading}
                setIsLoading={setIsChatLoading}
              />
            )}
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

      <div
        id="pdf-export-root"
        ref={pdfContentRef}
        aria-hidden
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          width: "880px",
          padding: "36px 38px",
          color: "#111827",
          backgroundColor: "#ffffff",
          fontFamily: '"Source Serif 4", Georgia, "Times New Roman", serif',
          fontSize: "1rem",
        }}
      >
        <header
          data-pdf-block="true"
          style={{ borderBottom: "2px solid #cbd5e1", paddingBottom: "0.8rem", marginBottom: "1rem" }}
        >
          <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.35rem", color: "#0f172a", lineHeight: 1.2 }}>
            TubeTutor Study Guide
          </h1>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", color: "#475569", fontSize: "0.88rem" }}>
            <span>{videoId ? `Video ID: ${videoId}` : "Video ID unavailable"}</span>
            <span>Generated: {pdfPreviewTimestamp}</span>
          </div>
        </header>

        <section className="pdf-avoid-break" style={{ marginBottom: "1.5rem", pageBreakInside: "avoid" }}>
          <h2
            data-pdf-block="true"
            style={{
              fontSize: "1.35rem",
              fontWeight: 700,
              borderBottom: "1px solid #cbd5e1",
              paddingBottom: "0.35rem",
              marginBottom: "0.8rem",
              color: "#0f172a",
            }}
          >
            Summary
          </h2>
          {hasGeneratedSummary ? (
            <article data-pdf-block="true" style={{ fontSize: "1rem", lineHeight: 1.72 }}>
              <StudyGuideMarkdown content={normalizedSummary} />
            </article>
          ) : (
            <p data-pdf-block="true" style={{ color: "#4b5563" }}>
              No generated summary available yet.
            </p>
          )}
        </section>
      </div>
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
  transcriptSegments,
  isTranscriptLoading,
  transcriptError,
}: {
  indexing: boolean;
  processingStatus: ProcessingStatus;
  indexError: string | null;
  processStats: { segments: number; chunks: number } | null;
  transcriptSegments: TranscriptSegment[];
  isTranscriptLoading: boolean;
  transcriptError: string | null;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Transcript</h3>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        {processingStatus === "processing" && (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-gtNavy dark:text-gtGold">
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
            <div className="h-2 overflow-hidden rounded-full bg-gtGold/20 dark:bg-gtGold/10">
              <div className="h-full w-1/2 animate-pulse bg-gtGold" />
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
          <p className="text-sm text-slate-500 dark:text-slate-300">
            The full video transcript will appear here once the video is processed.
          </p>
        )}

        {isTranscriptLoading && (
          <p className="text-sm text-slate-600 dark:text-slate-300">Loading transcript...</p>
        )}

        {!isTranscriptLoading && transcriptError && (
          <p className="text-sm text-red-600">{transcriptError}</p>
        )}

        {!isTranscriptLoading && !transcriptError && transcriptSegments.length > 0 && (
          <div className="max-h-[42vh] space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            {transcriptSegments.map((segment, index) => (
              <p key={`segment-${index}`} className="text-sm leading-6 text-slate-800 dark:text-slate-100">
                <span className="mr-2 text-xs text-slate-500 dark:text-slate-400">
                  [{typeof segment.start === "number" ? `${Math.floor(segment.start / 60)}:${String(Math.floor(segment.start % 60)).padStart(2, "0")}` : "--:--"}]
                </span>
                {segment.text || ""}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryPanel({
  summaryText,
  isGeneratingSummary,
  summaryError,
  onGenerateSummary,
  disabled,
}: {
  summaryText: string;
  isGeneratingSummary: boolean;
  summaryError: string | null;
  onGenerateSummary: () => void;
  disabled: boolean;
}) {
  const hasGeneratedSummary = summaryText.trim().length > 0;
  const normalizedSummary = normalizeStudyGuideMarkdown(summaryText);

  return (
    <div className="space-y-3 h-full min-h-0">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Study Guide</h3>

      <button
        onClick={onGenerateSummary}
        disabled={disabled || isGeneratingSummary}
        className="w-full rounded-lg bg-gtGold px-4 py-2 text-sm font-semibold text-gtNavy transition-colors hover:bg-[#c7b887] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gtGold dark:text-gtNavy dark:hover:bg-[#c7b887]"
      >
        {isGeneratingSummary ? "Generating..." : "Generate Study Guide"}
      </button>

      {summaryError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{summaryError}</p>
        </div>
      )}

      <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        {!summaryText && !isGeneratingSummary && !summaryError && (
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Generate a comprehensive study guide from the video transcript.
          </p>
        )}

        {hasGeneratedSummary && (
          <article className="max-w-none text-sm leading-7 text-slate-900 dark:text-slate-100">
            <StudyGuideMarkdown content={normalizedSummary} />
          </article>
        )}
      </div>
    </div>
  );
}

function ChatPanel({
  videoId,
  apiBaseUrl,
  messages,
  setMessages,
  question,
  setQuestion,
  isLoading,
  setIsLoading,
}: {
  videoId: string;
  apiBaseUrl: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  question: string;
  setQuestion: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <div className="space-y-3 h-full min-h-0">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Chat</h3>
      <ChatAssistant
        videoId={videoId}
        apiBaseUrl={apiBaseUrl}
        messages={messages}
        setMessages={setMessages}
        question={question}
        setQuestion={setQuestion}
        isLoading={isLoading}
        setIsLoading={setIsLoading}
      />
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
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Quiz</h3>
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex items-center gap-2 text-sm font-medium text-gtNavy dark:text-gtGold">
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
          <div className="h-2 overflow-hidden rounded-full bg-gtGold/20 dark:bg-gtGold/10">
            <div className="h-full w-1/2 animate-pulse bg-gtGold" />
          </div>
        </div>
      </div>
    );
  }

  if (quizError) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Quiz</h3>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm text-red-600">{quizError}</p>
          <p className="text-xs text-red-500">
            Make sure the transcript has been processed first before generating a quiz.
          </p>
          <button
            onClick={onRegenerate}
            className="mt-3 w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400"
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
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Quiz</h3>
        <p className="text-sm text-slate-500 dark:text-slate-300">
          AI-generated quiz questions based on the video content will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full flex flex-col -m-5">
      <div className="flex items-center justify-between gap-3 px-5 pt-3">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Quiz</h3>
        <button
          onClick={onRegenerate}
          className="rounded-full px-3 py-1 text-xs font-semibold text-gtNavy transition-colors hover:bg-gtGold/20 dark:text-gtGold dark:hover:bg-gtGold/10"
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

function ChatAssistant({
  videoId,
  apiBaseUrl,
  messages,
  setMessages,
  question,
  setQuestion,
  isLoading,
  setIsLoading,
}: {
  videoId: string;
  apiBaseUrl: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  question: string;
  setQuestion: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
}) {
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4 dark:bg-[#101214]">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Ask questions about this video and chat with the assistant.
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              message.role === "user"
                ? "ml-auto whitespace-pre-wrap bg-gtNavy text-slate-100 dark:bg-gtGold dark:text-gtNavy"
                : "mr-auto border border-slate-200 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            }`}
          >
            {message.role === "ai" ? (
              <ChatMarkdown content={message.content} />
            ) : (
              message.content
            )}
          </div>
        ))}

        {isLoading && (
          <div className="mr-auto rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            Thinking...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about this video..."
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-gtGold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !question.trim()}
            className="rounded-lg bg-gtGold px-4 py-2 text-sm font-semibold text-gtNavy transition-colors hover:bg-[#c7b887] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

