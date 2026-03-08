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

app = Flask(__name__)
ytt_api = YouTubeTranscriptApi()

# Allow the Next.js frontend to call this API from localhost:3000.
CORS(app, resources={r"/transcript": {"origins": ["http://localhost:3000"]}})


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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
