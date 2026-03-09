# INSTRUCTIONS.md

## Purpose
This file is for humans and LLM agents (Claude/GPT/Gemini) to quickly build, run, and verify TubeTutor.

## Project Summary
TubeTutor is a split frontend/backend app:
- Frontend: Next.js (App Router) in repository root
- Backend: Flask API in `flask_api/`
- Vector store: local ChromaDB persisted in `chroma_db/` (must NOT be committed)

Main workflow:
1. User enters YouTube URL on `/`
2. App navigates to `/workspace?v=<video_id>`
3. Frontend calls Flask `POST /process` to fetch transcript and index it
4. Flask can also serve `GET /search` for semantic retrieval

## Tech Stack
- Node.js + npm (Next.js 16)
- Python 3.10+ (tested with 3.12)
- Flask + youtube-transcript-api + LangChain + ChromaDB + sentence-transformers

## Required Environment Variables
Frontend (`.env.local` in repo root):
- `NEXT_PUBLIC_FLASK_API_URL=http://127.0.0.1:5000`

Optional (for OpenRouter integration in `lib/openrouter.ts`):
- `OPENROUTER_API_KEY=<your_openrouter_key>`

## Install Dependencies
### 1. Frontend dependencies
Run in repo root:
```bash
npm install
```

### 2. Backend dependencies
Run in repo root:
```bash
python -m venv .venv
```

Windows PowerShell:
```powershell
.\.venv\Scripts\Activate.ps1
pip install -r flask_api/requirements.txt
```

macOS/Linux:
```bash
source .venv/bin/activate
pip install -r flask_api/requirements.txt
```

## Run the App (Two Terminals)
### Terminal A: Flask API
From repo root, with venv activated:
```bash
python flask_api/app.py
```
Expected:
- Flask listens on `http://127.0.0.1:5000`

### Terminal B: Next.js frontend
From repo root:
```bash
npm run dev
```
Expected:
- Next.js runs on `http://localhost:3000`

## Build Commands
Frontend production build:
```bash
npm run build
npm run start
```

Backend has no dedicated build step; Python files can be syntax-checked with:
```bash
python -m py_compile flask_api/app.py flask_api/rag_engine.py
```

## Test Commands
There is currently no formal automated test suite in this repository.
Use lint + smoke tests.

### Frontend lint
```bash
npm run lint
```

### Backend API smoke tests
Use a real YouTube video id in place of `<VIDEO_ID>`.

Get transcript:
```bash
curl "http://127.0.0.1:5000/transcript?video_id=<VIDEO_ID>"
```

Process/index transcript:
```bash
curl -X POST "http://127.0.0.1:5000/process" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>"}'
```

Search indexed transcript:
```bash
curl "http://127.0.0.1:5000/search?video_id=<VIDEO_ID>&query=main%20topic"
```

## Key Endpoints
- `GET /transcript?video_id=...`
- `POST /process` with JSON body `{ "video_id": "..." }`
- `GET /search?video_id=...&query=...`

## Important Paths
- Frontend homepage: `app/page.js`
- Frontend workspace: `app/workspace/page.tsx`
- Flask app: `flask_api/app.py`
- RAG engine: `flask_api/rag_engine.py`
- OpenRouter client: `lib/openrouter.ts`

## Git Hygiene
Do NOT commit vector database files.
- `.gitignore` includes `/chroma_db`
- If files were tracked previously, untrack with:
```bash
git rm -r --cached chroma_db
```

## Common Issues
1. "Failed to fetch" in workspace:
- Ensure Flask is running on `127.0.0.1:5000`
- Ensure `NEXT_PUBLIC_FLASK_API_URL` points to the same host/port

2. Transcript unavailable errors:
- Some videos disable transcripts or are region/age restricted

3. Slow first indexing:
- `sentence-transformers` model download can take time on first run

## LLM Execution Checklist
An LLM agent should do these steps in order:
1. Install Node dependencies (`npm install`)
2. Create/activate Python venv
3. Install backend requirements
4. Set `.env.local` with `NEXT_PUBLIC_FLASK_API_URL`
5. Start Flask API
6. Start Next.js app
7. Open `http://localhost:3000`, submit YouTube URL
8. Confirm `/workspace` shows processing -> ready status
9. Run API smoke tests for `/transcript`, `/process`, `/search`
