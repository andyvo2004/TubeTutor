# INSTRUCTIONS.md

## Purpose
This file is intended for both humans and LLM agents (Claude, GPT, Gemini, etc.) to build, run, and verify TubeTutor with minimal guesswork.

## What TubeTutor Does
TubeTutor turns a YouTube video into an interactive learning workspace with:
- Transcript ingestion and semantic indexing (RAG pipeline)
- A Learning Assistant sidebar Q&A chat grounded in transcript chunks
- AI-generated JSON multiple-choice quizzes
- Frontend quiz interaction with score tracking and final results

## Architecture Overview
- Frontend: Next.js 16 App Router at repository root
- Backend: Flask API in `flask_api/`
- Retrieval layer: ChromaDB persisted locally under `chroma_db/`
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`
- LLM provider for chat + quiz generation: OpenRouter (via LangChain `ChatOpenAI`)

High-level flow:
1. User pastes a YouTube URL on `/` (`app/page.js`)
2. Frontend validates transcript availability via `GET /transcript`
3. App routes to `/workspace?v=<video_id>` (`app/workspace/page.tsx`)
4. Workspace triggers `POST /process` to fetch transcript and build vector chunks
5. Summary tab (Learning Assistant) sends questions to `POST /chat` (RAG + LLM answer)
6. Quiz tab auto-generates quiz via `POST /generate_quiz` and renders interactive scoring UI

## Key Features Implemented
### 1) RAG logic with LLM in Flask
- `flask_api/rag_engine.py`
	- `store_transcript_segments(video_id, transcript_segments)`:
		- Concatenates transcript text
		- Splits with `RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)`
		- Stores chunks in Chroma collection `yt-<sanitized_video_id>`
	- `search_transcript_chunks(video_id, query, k=3)`:
		- Similarity search + relevance scores
	- `ask_video_question(video_id, user_question)`:
		- Retrieves top `k=4` chunks and returns joined context
- `flask_api/app.py` `POST /chat`:
	- Gets transcript context from RAG layer
	- Calls OpenRouter LLM (`ChatOpenAI`)
	- Uses guardrail prompt: answer using only transcript context; otherwise return fallback text

### 2) Learning Assistant sidebar Q&A interface
- Implemented in `app/workspace/page.tsx` (`Summary` tab -> `ChatAssistant`)
- UX behavior:
	- User and AI message bubbles
	- Scroll-to-bottom while streaming interaction state
	- "Thinking..." loading state
	- Sends `{ video_id, question }` to `POST /chat`

### 3) Prompt logic for JSON-formatted quizzes
- Implemented in `flask_api/app.py` `POST /generate_quiz`
- Backend flow:
	- Pulls multiple relevant transcript chunks via `search_transcript_chunks`
	- Shuffles chunk ordering using `quiz_nonce` to vary quiz generations
	- Truncates context to ~5000 characters
	- Sends strict system prompt requiring valid JSON only:
		- `{"questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer": "A"}]}`
	- Parses LLM output with `json.loads`
	- Returns parse errors with raw response for debugging

### 4) Frontend quiz state and scoring mechanics
- `components/InteractiveQuiz.tsx`
	- Tracks:
		- Current question index
		- Score
		- Selected answer
		- Completion state
	- Scoring:
		- Converts selected option index to `A/B/C/D`
		- Normalizes answer letter from backend
		- Increments score only on correct answer
	- UX:
		- Correct/incorrect highlighting
		- Inline feedback
		- Next question flow
		- Final score + percentage
		- Retake quiz reset

## Repository Structure (Important Files)
- `app/page.js`: URL input, video ID extraction, transcript preflight check
- `app/workspace/page.tsx`: main workspace UI (Transcript, Summary, Quiz tabs)
- `components/InteractiveQuiz.tsx`: quiz logic and scoring
- `components/InteractiveQuiz.css`: quiz styling
- `flask_api/app.py`: Flask routes, CORS, OpenRouter-powered chat/quiz generation
- `flask_api/rag_engine.py`: transcript chunking/indexing/retrieval
- `flask_api/requirements.txt`: Python dependencies
- `lib/openrouter.ts`: Next-side OpenRouter helper (currently optional for runtime)
- `.gitignore`: excludes `chroma_db` and environment files

## Prerequisites
- Node.js 20+ and npm
- Python 3.10+ (3.12 works)
- Internet access (YouTube transcript fetch + model/API calls)

## Environment Variables
Create `.env.local` in repo root:

```env
NEXT_PUBLIC_FLASK_API_URL=http://127.0.0.1:5000
OPENROUTER_API_KEY=<your_openrouter_api_key>
```

Optional variables used by Flask backend:

```env
OPENROUTER_MODEL=openai/gpt-4o-mini
QUIZ_TEMPERATURE=0.8
```

Notes:
- `OPENROUTER_API_KEY` is required for `/chat` and `/generate_quiz`.
- If missing, those endpoints return HTTP 500 with a clear error message.

## Setup
### 1) Install frontend dependencies
From repo root:

```bash
npm install
```

### 2) Create Python virtual environment
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

```bash
python flask_api/app.py
```

Expected:
- `http://127.0.0.1:5000` is available

### Terminal B: Next.js frontend
From repo root:

```bash
npm run dev
```

Expected:
- `http://localhost:3000` is available

## Build and Static Checks
Frontend production build:

```bash
npm run build
npm run start
```

Frontend lint:

```bash
npm run lint
```

Python syntax check:

```bash
python -m py_compile flask_api/app.py flask_api/rag_engine.py
```

## API Endpoints
- `GET /transcript?video_id=<VIDEO_ID>`
- `POST /process` with JSON `{ "video_id": "<VIDEO_ID>" }`
- `GET /search?video_id=<VIDEO_ID>&query=<QUERY>`
- `POST /chat` with JSON `{ "video_id": "<VIDEO_ID>", "question": "..." }`
- `POST /generate_quiz` with JSON `{ "video_id": "<VIDEO_ID>", "quiz_nonce": "..." }`

All routes are currently CORS-allowed for `http://localhost:3000`.

## Manual Verification Plan (Recommended)
Use a real transcript-enabled YouTube video ID.

1. Home page preflight
- Open `http://localhost:3000`
- Submit YouTube URL
- Confirm navigation to `/workspace?v=<video_id>` only when transcript is valid

2. Transcript processing
- Confirm status transitions in workspace header: `Processing` -> `Ready`
- Confirm transcript panel shows indexed segment/chunk counts

3. Learning Assistant (Summary tab)
- Ask a question about the video
- Confirm chat request goes to `POST /chat`
- Confirm AI answer appears in bubble format

4. Quiz generation (Quiz tab)
- Confirm quiz auto-generates after processing
- Confirm 5 MCQ questions appear
- Use "New Quiz" to regenerate and verify quiz can change

5. Quiz scoring mechanics
- Answer questions and verify:
	- Correct answers increment score
	- Incorrect answers do not increment score
	- Final score and percentage are shown
	- "Retake Quiz" resets state

## CLI Smoke Tests (Backend)
Replace `<VIDEO_ID>` with a valid id.

```bash
curl "http://127.0.0.1:5000/transcript?video_id=<VIDEO_ID>"
curl -X POST "http://127.0.0.1:5000/process" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>"}'
curl "http://127.0.0.1:5000/search?video_id=<VIDEO_ID>&query=main%20topic"
curl -X POST "http://127.0.0.1:5000/chat" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>","question":"What is the main idea?"}'
curl -X POST "http://127.0.0.1:5000/generate_quiz" -H "Content-Type: application/json" -d '{"video_id":"<VIDEO_ID>"}'
```

## Known Limitations
- No formal automated test suite yet (only lint/smoke/manual checks)
- Videos with disabled/unavailable transcripts cannot be processed
- First run may be slow due to embedding model download
- ChromaDB is local and not intended for production persistence in this setup

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
4. Set `.env.local` with `NEXT_PUBLIC_FLASK_API_URL` and `OPENROUTER_API_KEY`
5. Start Flask API (`python flask_api/app.py`)
6. Start Next.js (`npm run dev`)
7. Validate full workflow: transcript preflight -> process -> chat -> quiz -> scoring
