"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function extractVideoId(input) {
  try {
    const parsed = new URL(input);

    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "").trim();
    }

    if (parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v")?.trim() ?? "";
    }

    return "";
  } catch {
    return "";
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState("light");
  const [themeReady, setThemeReady] = useState(false);
  const router = useRouter();
  const apiBaseUrl = process.env.NEXT_PUBLIC_FLASK_API_URL ?? "http://127.0.0.1:5000";

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

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const videoId = extractVideoId(url);
      if (!videoId) {
        setStatus({ error: "Please enter a valid YouTube URL." });
        return;
      }

      router.push(`/workspace?v=${encodeURIComponent(videoId)}`);
    } catch {
      setStatus({
        error:
          "Could not connect to the Flask API. Make sure it is running on port 5000.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <button
        type="button"
        onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
        className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 sm:right-6 sm:top-6"
        aria-label="Toggle dark mode"
        title="Toggle dark mode"
      >
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${theme === "dark" ? "bg-[#b3a369]" : "bg-[#262626]"}`} />
        {theme === "dark" ? "Dark" : "Light"}
      </button>
      <h1 className="mb-2 text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        TubeTutor
      </h1>
      <p className="mb-10 text-lg text-zinc-500 dark:text-zinc-400">
        Paste a YouTube URL and let AI help you learn
      </p>

      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xl flex-col gap-3 sm:flex-row"
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="h-12 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
        />
        <button
          type="submit"
          disabled={loading}
          className="h-12 rounded-lg bg-zinc-900 px-6 font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {loading ? "Generating..." : "Generate"}
        </button>
      </form>

      {status && (
        <p className={`mt-6 text-sm ${status.error ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
          {status.error || status.success}
        </p>
      )}
    </div>
  );
}
