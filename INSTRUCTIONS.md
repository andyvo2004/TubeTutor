# INSTRUCTIONS.md

## Purpose
This file is for both humans and LLM agents (Claude, GPT, Gemini, etc.) to run a seamless AI workflow for TubeTutor: understand the app, install dependencies, run services, and verify behavior with minimal guesswork.

## Project Snapshot
TubeTutor turns a YouTube video into an interactive study workspace with:
- Transcript ingestion and semantic indexing (RAG)
- Study Guide generation (map-reduce summarization)
- Chat Q&A grounded in transcript chunks
- AI-generated multiple-choice quizzes with explanations
- Quiz scoring and results UI
- Study Guide PDF export from the frontend

## Architecture
- Frontend: Next.js 16 App Router at repository root
- Backend: Flask API in `flask_api/`
- Vector store: ChromaDB persisted locally under `chroma_db/`
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`
- LLM provider: OpenRouter via LangChain `ChatOpenAI`

## Current End-to-End Flow
1. User pastes a YouTube URL on `/` (`app/page.js`).
2. Frontend extracts `video_id` and routes to `/workspace?v=<video_id>`.
3. Workspace auto-calls `POST /process` to fetch transcript and build chunks.
4. Workspace also fetches transcript content via `GET /transcript`.
5. Study Guide tab calls `POST /summary` when user clicks Generate.
6. Chat tab sends `{ video_id, question }` to `POST /chat`.
7. Quiz auto-generates via `POST /generate_quiz` after processing.
8. User can regenerate quiz and export Study Guide as PDF.

## Key Backend Behaviors
### Transcript and RAG (`flask_api/rag_engine.py`)
- `store_transcript_segments(video_id, transcript_segments)`:
  - Concatenates transcript text
  - Splits with `RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)`
  - Replaces prior collection and stores to Chroma collection `yt-<sanitized_video_id>`
- `search_transcript_chunks(video_id, query, k=3)`:
  - Similarity search with relevance scores
- `ask_video_question(video_id, user_question)`:
  - Retrieves top 4 relevant chunks as prompt context
- `generate_map_reduce_summary(video_id)`:
  - Builds grouped chunk documents
  - Runs map-reduce summarization
  - Includes retry/rate-limit fallback path

### Flask API (`flask_api/app.py`)
- `GET /transcript`
  - Fetches transcript from YouTube
  - Fallback: if fetch fails, returns already stored transcript chunks when available
- `POST /process`
  - Fetches transcript and stores chunked vectors
  - Returns `segments` and `chunks`
- `POST /chat`
  - Uses transcript context from RAG
  - Guardrail: if answer not found in context, instructs fallback answer
- `POST /generate_quiz`
  - Retrieves transcript chunks
  - Uses `quiz_nonce` to shuffle context and vary quiz generation
  - Returns strict JSON quiz structure
- `POST /summary`
  - Generates map-reduce study guide markdown
  - Sanitizes markdown/math/table formatting for frontend rendering

## Key Frontend Behaviors
### Home (`app/page.js`)
- Accepts YouTube URL
- Extracts video ID and routes to workspace

### Workspace (`app/workspace/page.tsx`)
Tabs:
- Transcript
- Study Guide
- Chat
- Quiz

Also provides:
- Processing status pill: Waiting / Processing / Ready / Failed
- Theme toggle (light/dark)
- Study Guide PDF export (`html2canvas` + `jsPDF`)
- Markdown + table + math rendering (`react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`)

### Quiz UI (`components/InteractiveQuiz.tsx`)
- Tracks current question, score, selected answer, completion state
- Accepts answer letter from backend and normalizes format
- Uses backend explanation fields:
  - `explanation`
  - `option_explanations`
- Shows correct/incorrect feedback and final percentage

## Important Files
- `app/page.js`: home URL input and video routing
- `app/workspace/page.tsx`: main workspace UI, tabs, chat/summary/quiz wiring, PDF export
- `components/InteractiveQuiz.tsx`: quiz interaction and scoring logic
- `flask_api/app.py`: Flask routes and OpenRouter calls
- `flask_api/rag_engine.py`: transcript chunking, retrieval, and summary generation
- `flask_api/requirements.txt`: Python dependencies
- `package.json`: frontend scripts/dependencies
- `lib/openrouter.ts`: optional Next-side OpenRouter helper

## Prerequisites
- Node.js 20+ and npm
- Python 3.10+ (3.12 works)
- Internet access (YouTube transcript fetch, model download, OpenRouter calls)

## Environment Variables
### Frontend (Next.js)
Create `.env.local` in repository root:

```env
NEXT_PUBLIC_FLASK_API_URL=http://127.0.0.1:5000
```

### Backend (Flask)
Set in your shell before starting Flask:

Required:
- `OPENROUTER_API_KEY=<your_openrouter_api_key>`

Optional:
- `OPENROUTER_MODEL=<model_name>`
- `QUIZ_TEMPERATURE=0.8`
- `SUMMARY_MAX_MAP_CALLS=8`
- `SUMMARY_RETRY_ATTEMPTS=4`
- `SUMMARY_REDUCE_BATCH_SIZE=8`

Notes:
- `OPENROUTER_API_KEY` is required for `/chat`, `/generate_quiz`, and `/summary`.
- If missing, those endpoints return clear 4xx/5xx error messages.

## Setup
### 1) Install frontend dependencies
From repo root:

```bash
npm install
```

### 2) Create Python virtual environment and install backend dependencies
From repo root:

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

## Run Locally (Two Terminals)
### Terminal A: Flask API
From repo root, with venv activated:

Windows PowerShell:

```powershell
$env:OPENROUTER_API_KEY="<your_openrouter_api_key>"
# Optional:
# $env:OPENROUTER_MODEL="stepfun/step-3.5-flash:free"
python flask_api/app.py
```

macOS/Linux:

```bash
export OPENROUTER_API_KEY="<your_openrouter_api_key>"
# Optional:
# export OPENROUTER_MODEL="stepfun/step-3.5-flash:free"
python flask_api/app.py
```

Expected:
- API available at `http://127.0.0.1:5000`

### Terminal B: Next.js frontend
From repo root:

```bash
npm run dev
```

Expected:
- Frontend available at `http://localhost:3000`

## Build, Lint, and Syntax Checks
Frontend lint:

```bash
npm run lint
```

Frontend production build and serve:

```bash
npm run build
npm run start
```

Backend syntax check:

```bash
python -m py_compile flask_api/app.py flask_api/rag_engine.py
```

## Test Status
- There is currently no formal automated unit/integration test suite.
- Recommended validation is manual workflow checks plus API smoke tests below.

## API Endpoints
- `GET /transcript?video_id=<VIDEO_ID>`
- `POST /process` with JSON `{ "video_id": "<VIDEO_ID>" }`
- `GET /search?video_id=<VIDEO_ID>&query=<QUERY>`
- `POST /chat` with JSON `{ "video_id": "<VIDEO_ID>", "question": "..." }`
- `POST /generate_quiz` with JSON `{ "video_id": "<VIDEO_ID>", "quiz_nonce": "..." }`
- `POST /summary` with JSON `{ "video_id": "<VIDEO_ID>" }`

Current CORS allowlist is `http://localhost:3000` for all above routes.

## Manual Verification Plan
Use a transcript-enabled YouTube video ID.

1. Home and routing
- Open `http://localhost:3000`
- Submit YouTube URL
- Confirm navigation to `/workspace?v=<video_id>`

2. Processing and transcript
- Confirm status transitions: `Processing` -> `Ready`
- Confirm transcript tab shows transcript entries and indexing stats (`segments`, `chunks`)

3. Study Guide
- Open Study Guide tab
- Click `Generate Study Guide`
- Confirm markdown content appears (headings/lists/tables/math)
- Click `Download as PDF` and confirm file downloads

4. Chat
- Ask a transcript-grounded question in Chat tab
- Confirm response appears in assistant bubble

5. Quiz
- Confirm quiz auto-generates after processing
- Confirm 5 MCQ questions render with explanations
- Click `New Quiz` and confirm regeneration behavior

6. Scoring
- Answer all questions and verify:
  - correct answers increment score
  - incorrect answers do not increment score
  - final score and percentage are shown
  - retake resets quiz state

## CLI Smoke Tests (Backend)
Replace `<VIDEO_ID>` with a valid ID.

### PowerShell (recommended on Windows)
```powershell
Invoke-RestMethod "http://127.0.0.1:5000/transcript?video_id=<VIDEO_ID>"

Invoke-RestMethod "http://127.0.0.1:5000/process" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"video_id":"<VIDEO_ID>"}'

Invoke-RestMethod "http://127.0.0.1:5000/search?video_id=<VIDEO_ID>&query=main%20topic"

Invoke-RestMethod "http://127.0.0.1:5000/chat" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"video_id":"<VIDEO_ID>","question":"What is the main idea?"}'

Invoke-RestMethod "http://127.0.0.1:5000/generate_quiz" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"video_id":"<VIDEO_ID>","quiz_nonce":"manual-smoke"}'

Invoke-RestMethod "http://127.0.0.1:5000/summary" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"video_id":"<VIDEO_ID>"}'
```

### Bash/curl
```bash
curl "http://127.0.0.1:5000/transcript?video_id=<VIDEO_ID>"
curl -X POST "http://127.0.0.1:5000/process" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>"}'
curl "http://127.0.0.1:5000/search?video_id=<VIDEO_ID>&query=main%20topic"
curl -X POST "http://127.0.0.1:5000/chat" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>","question":"What is the main idea?"}'
curl -X POST "http://127.0.0.1:5000/generate_quiz" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>","quiz_nonce":"manual-smoke"}'
curl -X POST "http://127.0.0.1:5000/summary" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>"}'
```

## Known Limitations
- No formal automated test suite yet.
- Videos with disabled/unavailable transcripts cannot be processed.
- First run can be slow while embedding/model assets download.
- ChromaDB persistence is local-only in this setup.
- OpenRouter free-tier rate limits can affect summary generation on long transcripts.

## Git Hygiene
Do not commit local vector DB artifacts.
- `chroma_db/` is ignored in `.gitignore`
- If previously tracked:

```bash
git rm -r --cached chroma_db
```

## LLM Agent Quick Checklist
1. Install Node dependencies (`npm install`)
2. Create and activate Python venv
3. Install Flask requirements
4. Set `.env.local` with `NEXT_PUBLIC_FLASK_API_URL`
5. Export `OPENROUTER_API_KEY` in the Flask terminal
6. Start Flask API (`python flask_api/app.py`)
7. Start Next.js (`npm run dev`)
8. Validate: process -> transcript -> study guide -> chat -> quiz -> score -> PDF export
