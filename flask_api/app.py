from __future__ import annotations

import json
import os
import random
import re
from flask import Flask, jsonify, request
from flask_cors import CORS
from langchain_openai import ChatOpenAI
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter
from youtube_transcript_api._errors import (
    InvalidVideoId,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)
from rag_engine import (
    ask_video_question,
    generate_map_reduce_summary,
    get_stored_transcript_chunks,
    search_transcript_chunks,
    store_transcript_segments,
)

app = Flask(__name__)
ytt_api = YouTubeTranscriptApi()


def _sanitize_study_guide_markdown(raw: str) -> str:
    if not raw:
        return ""

    text = raw.replace("\r\n", "\n")
    text = text.replace("\\n", "\n")

    # Normalize common malformed delimiter patterns.
    text = text.replace("\\$", "$")
    text = re.sub(r"\${3,}", "$$", text)
    text = re.sub(r"\$\$\s*\$+", "$$", text)
    text = re.sub(r"\$+\s*\$\$", "$$", text)

    # Convert \(...\) and \[...\] to markdown-math delimiters.
    text = re.sub(r"\\\((.*?)\\\)", lambda m: f"${m.group(1).strip()}$", text, flags=re.S)
    text = re.sub(r"\\\[(.*?)\\\]", lambda m: f"$$\n{m.group(1).strip()}\n$$", text, flags=re.S)

    # Ensure begin/end blocks are valid display math blocks.
    def _wrap_begin_end(match: re.Match[str]) -> str:
        env = match.group(1)
        body = match.group(2)
        body = re.sub(r"\\{3,}", r"\\\\", body)
        body = re.sub(r"\\\s+", r"\\\\ ", body)
        body = re.sub(r"\n{3,}", "\n\n", body)
        return f"$$\n\\begin{{{env}}}{body}\\end{{{env}}}\n$$"

    text = re.sub(r"\\begin\{([a-zA-Z*]+)\}([\s\S]*?)\\end\{\1\}", _wrap_begin_end, text)

    # Put headings on their own line.
    text = re.sub(r"([^\n])\s+(#{1,6}\s+)", r"\1\n\n\2", text)

    # Lift inline display-math segments to standalone lines.
    rebuilt_lines: list[str] = []
    for line in text.split("\n"):
        current = line
        guard = 0
        produced = False
        while guard < 20:
            start = current.find("$$")
            if start == -1:
                break
            end = current.find("$$", start + 2)
            if end == -1:
                break

            before = current[:start].rstrip().rstrip(":")
            math_body = current[start + 2 : end].strip()
            after = current[end + 2 :].lstrip().lstrip(":").lstrip()

            if before:
                rebuilt_lines.append(before)
            rebuilt_lines.append(f"$$\n{math_body}\n$$")
            current = after
            produced = True
            guard += 1

        if produced:
            if current.strip():
                rebuilt_lines.append(current.strip())
        else:
            rebuilt_lines.append(line)

    text = "\n".join(rebuilt_lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _extract_json_object(raw: str) -> dict:
    text = (raw or "").strip()
    if not text:
        raise json.JSONDecodeError("Empty response", text, 0)

    # Handle common LLM wrapper style: ```json ... ```
    fenced_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if fenced_match:
        text = fenced_match.group(1).strip()

    # Try direct parse first.
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Fallback: extract the first top-level JSON object from noisy text.
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start : end + 1]
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed

    raise json.JSONDecodeError("No JSON object found", text, 0)

# Allow the Next.js frontend to call this API from localhost:3000.
CORS(
    app,
    resources={
        r"/transcript": {"origins": ["http://localhost:3000"]},
        r"/process": {"origins": ["http://localhost:3000"]},
        r"/search": {"origins": ["http://localhost:3000"]},
        r"/chat": {"origins": ["http://localhost:3000"]},
        r"/generate_quiz": {"origins": ["http://localhost:3000"]},
        r"/summary": {"origins": ["http://localhost:3000"]},
    },
)


@app.get("/transcript")
def get_transcript():
    video_id = request.args.get("video_id", "").strip()
    if not video_id:
        return jsonify({"error": "Missing required query parameter: video_id"}), 400

    try:
        transcript = ytt_api.fetch(video_id)
        formatted = JSONFormatter().format_transcript(transcript)

        # JSONFormatter returns a JSON string; parse it before sending.
        return jsonify(
            {
                "video_id": video_id,
                "transcript": json.loads(formatted),
            }
        ), 200
    except TranscriptsDisabled:
        return (
            jsonify({"error": "Transcripts are disabled for this video."}),
            403,
        )
    except (InvalidVideoId, VideoUnavailable):
        return jsonify({"error": "Invalid or unavailable video_id."}), 404
    except NoTranscriptFound:
        return jsonify({"error": "No transcript found for this video."}), 404
    except Exception as exc:
        # If direct YouTube transcript fetch fails, fall back to already-processed chunks.
        try:
            stored_chunks = get_stored_transcript_chunks(video_id)
            transcript_segments = [{"text": chunk.get("text", "")} for chunk in stored_chunks]
            return jsonify({"video_id": video_id, "transcript": transcript_segments}), 200
        except Exception:
            return jsonify({"error": "Failed to fetch transcript.", "details": str(exc)}), 500


@app.post("/process")
def process_transcript():
    payload = request.get_json(silent=True) or {}
    video_id = str(payload.get("video_id", "")).strip()

    if not video_id:
        return jsonify({"error": "Missing required field: video_id"}), 400

    try:
        transcript = ytt_api.fetch(video_id)
        transcript_segments = json.loads(JSONFormatter().format_transcript(transcript))
        chunk_count = store_transcript_segments(video_id, transcript_segments)

        return (
            jsonify(
                {
                    "message": "Transcript processed and stored successfully.",
                    "video_id": video_id,
                    "segments": len(transcript_segments),
                    "chunks": chunk_count,
                }
            ),
            200,
        )
    except TranscriptsDisabled:
        return jsonify({"error": "Transcripts are disabled for this video."}), 403
    except (InvalidVideoId, VideoUnavailable):
        return jsonify({"error": "Invalid or unavailable video_id."}), 404
    except NoTranscriptFound:
        return jsonify({"error": "No transcript found for this video."}), 404
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Failed to process transcript.", "details": str(exc)}), 500


@app.get("/search")
def search_transcript():
    video_id = request.args.get("video_id", "").strip()
    query = request.args.get("query", "").strip()

    if not video_id:
        return jsonify({"error": "Missing required query parameter: video_id"}), 400
    if not query:
        return jsonify({"error": "Missing required query parameter: query"}), 400

    try:
        top_chunks = search_transcript_chunks(video_id=video_id, query=query, k=3)
        return (
            jsonify(
                {
                    "video_id": video_id,
                    "query": query,
                    "results": top_chunks,
                }
            ),
            200,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Failed to search transcript.", "details": str(exc)}), 500


@app.post("/chat")
def chat_with_video_context():
    payload = request.get_json(silent=True) or {}
    video_id = str(payload.get("video_id", "")).strip()
    question = str(payload.get("question", "")).strip()

    if not video_id:
        return jsonify({"error": "Missing required field: video_id"}), 400
    if not question:
        return jsonify({"error": "Missing required field: question"}), 400

    try:
        context = ask_video_question(video_id=video_id, user_question=question)

        openrouter_api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not openrouter_api_key:
            return jsonify({"error": "Missing OPENROUTER_API_KEY environment variable."}), 500

        openrouter_model = os.getenv("OPENROUTER_MODEL", "").strip()
        if not openrouter_model:
            return jsonify({"error": "Missing OPENROUTER_MODEL environment variable."}), 500

        chat_model = ChatOpenAI(
            api_key=openrouter_api_key,
            base_url="https://openrouter.ai/api/v1",
            model=openrouter_model,
            temperature=0,
        )

        system_prompt = (
            "You are a helpful study assistant. Answer the user's question using ONLY "
            "the provided transcript context. If the answer is not in the context, "
            "say 'I cannot find the answer in this video.'"
        )
        user_prompt = (
            f"Transcript context:\n{context}\n\n"
            f"User question:\n{question}"
        )

        response = chat_model.invoke(
            [
                ("system", system_prompt),
                ("human", user_prompt),
            ]
        )

        return (
            jsonify(
                {
                    "video_id": video_id,
                    "question": question,
                    "answer": response.content,
                }
            ),
            200,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Failed to generate answer.", "details": str(exc)}), 500


@app.post("/generate_quiz")
def generate_quiz():
    payload = request.get_json(silent=True) or {}
    video_id = str(payload.get("video_id", "")).strip()
    quiz_nonce = str(payload.get("quiz_nonce", "")).strip() or str(random.randint(100000, 999999))

    if not video_id:
        return jsonify({"error": "Missing required field: video_id"}), 400

    try:
        # Retrieve transcript context (up to 5000 characters)
        try:
            # Use multiple generic queries to get diverse content chunks
            transcript_chunks = search_transcript_chunks(video_id=video_id, query="main topic summary overview", k=10)
            # Shuffle chunk order based on nonce to vary context composition between generations.
            shuffled_chunks = list(transcript_chunks)
            random.Random(quiz_nonce).shuffle(shuffled_chunks)
            context = "\n\n".join([chunk["text"] for chunk in shuffled_chunks])
            # Truncate to 5000 characters
            context = context[:5000] if context else ""
        except ValueError as e:
            # If no processed transcript found, return error
            return jsonify({"error": f"No processed transcript found for this video. Run /process first. ({str(e)})"}), 400

        if not context or len(context.strip()) == 0:
            return jsonify({"error": "Could not retrieve transcript context for quiz generation. Transcript may be empty."}), 400

        # Get OpenRouter API key
        openrouter_api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not openrouter_api_key:
            return jsonify({"error": "Missing OPENROUTER_API_KEY environment variable."}), 500

        openrouter_model = os.getenv("OPENROUTER_MODEL", "").strip()
        if not openrouter_model:
            return jsonify({"error": "Missing OPENROUTER_MODEL environment variable."}), 500

        # Configure LangChain ChatOpenAI for OpenRouter
        chat_model = ChatOpenAI(
            api_key=openrouter_api_key,
            base_url="https://openrouter.ai/api/v1",
            model=openrouter_model,
            temperature=float(os.getenv("QUIZ_TEMPERATURE", "0.8")),
        )

        # System prompt that strictly demands JSON response
        system_prompt = (
            "You are an expert quiz generator. Generate exactly 5 multiple-choice questions "
            "based on the provided transcript context. "
            "Your response MUST be ONLY a valid JSON object with no additional text. "
            "The JSON MUST have this exact format:\n"
            '{"questions": [{"question": "text", "options": ["A", "B", "C", "D"], "answer": "A", "explanation": "Overall explanation", "option_explanations": {"A": "Why A is right/wrong", "B": "Why B is right/wrong", "C": "Why C is right/wrong", "D": "Why D is right/wrong"}}]}\n'
            "Each question must have exactly 4 options (A, B, C, D) and the answer must be one of those letters. "
            "Include both an overall explanation and per-option explanations so learners understand why each option is correct or incorrect. "
            "Generate questions that test understanding of the key concepts in the transcript."
        )

        user_prompt = (
            f"Transcript context:\n{context}\n\n"
            f"Variation key: {quiz_nonce}\n"
            "Generate 5 multiple-choice questions."
        )

        # Invoke the model
        response = chat_model.invoke(
            [
                ("system", system_prompt),
                ("human", user_prompt),
            ]
        )

        # Parse model output and tolerate markdown code-fence wrappers.
        try:
            quiz_json = _extract_json_object(str(response.content))
        except json.JSONDecodeError as exc:
            return jsonify({
                "error": "Failed to parse quiz response as valid JSON.",
                "details": str(exc),
                "raw_response": response.content
            }), 500

        if not isinstance(quiz_json, dict) or not isinstance(quiz_json.get("questions"), list):
            return jsonify({
                "error": "Invalid quiz format from model.",
                "details": "Expected a JSON object with a 'questions' array.",
                "raw_response": response.content
            }), 500

        return (
            jsonify(
                {
                    "video_id": video_id,
                    "quiz_nonce": quiz_nonce,
                    "quiz": quiz_json,
                }
            ),
            200,
        )

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Failed to generate quiz.", "details": str(exc)}), 500


@app.post("/summary")
def generate_study_guide():
    payload = request.get_json(silent=True) or {}
    video_id = str(payload.get("video_id", "")).strip()

    if not video_id:
        return jsonify({"error": "Missing required field: video_id"}), 400

    try:
        summary = generate_map_reduce_summary(video_id)
        cleaned_summary = _sanitize_study_guide_markdown(summary)

        return (
            jsonify(
                {
                    "video_id": video_id,
                    "summary": cleaned_summary,
                }
            ),
            200,
        )

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": "Failed to generate study guide.", "details": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
