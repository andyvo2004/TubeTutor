from __future__ import annotations

import json
from flask import Flask, jsonify, request
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter
from youtube_transcript_api._errors import (
    InvalidVideoId,
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)
from rag_engine import search_transcript_chunks, store_transcript_segments

app = Flask(__name__)
ytt_api = YouTubeTranscriptApi()

# Allow the Next.js frontend to call this API from localhost:3000.
CORS(
    app,
    resources={
        r"/transcript": {"origins": ["http://localhost:3000"]},
        r"/process": {"origins": ["http://localhost:3000"]},
        r"/search": {"origins": ["http://localhost:3000"]},
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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
