from __future__ import annotations

import os
import re
import importlib
import time
from typing import Any

from chromadb import PersistentClient
from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_openai import ChatOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma


def _to_collection_name(video_id: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "-", video_id.strip().lower())
    cleaned = cleaned.strip("-")

    if not cleaned:
        cleaned = "video"

    # Chroma collection names are stricter than YouTube IDs.
    return f"yt-{cleaned}"[:63]


def store_transcript_segments(video_id: str, transcript_segments: list[dict[str, Any]]) -> int:
    full_text = " ".join(
        str(segment.get("text", "")).strip()
        for segment in transcript_segments
        if isinstance(segment, dict)
    ).strip()

    if not full_text:
        raise ValueError("Transcript is empty.")

    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = splitter.split_text(full_text)

    if not chunks:
        raise ValueError("No chunks were generated from transcript.")

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    chroma_client = PersistentClient(path="./chroma_db")
    collection_name = _to_collection_name(video_id)

    # Re-processes should overwrite prior chunks for the same video collection.
    try:
        chroma_client.delete_collection(collection_name)
    except Exception:
        pass

    vectorstore = Chroma(
        client=chroma_client,
        collection_name=collection_name,
        embedding_function=embeddings,
    )

    ids = [f"{video_id}-{index}" for index in range(len(chunks))]
    metadatas = [
        {"video_id": video_id, "chunk_index": index}
        for index in range(len(chunks))
    ]

    vectorstore.add_texts(texts=chunks, ids=ids, metadatas=metadatas)
    return len(chunks)


def search_transcript_chunks(video_id: str, query: str, k: int = 3) -> list[dict[str, Any]]:
    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("Query is required.")

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    chroma_client = PersistentClient(path="./chroma_db")
    collection_name = _to_collection_name(video_id)

    # Ensure the collection exists before searching.
    try:
        chroma_client.get_collection(collection_name)
    except Exception as exc:
        raise ValueError(
            "No processed transcript found for this video. Run /process first."
        ) from exc

    vectorstore = Chroma(
        client=chroma_client,
        collection_name=collection_name,
        embedding_function=embeddings,
    )

    matches = vectorstore.similarity_search_with_relevance_scores(
        query=normalized_query,
        k=k,
    )

    results: list[dict[str, Any]] = []
    for index, (doc, score) in enumerate(matches):
        results.append(
            {
                "rank": index + 1,
                "text": doc.page_content,
                "score": float(score),
                "metadata": doc.metadata or {},
            }
        )

    return results


def ask_video_question(video_id: str, user_question: str) -> str:
    normalized_question = user_question.strip()
    if not normalized_question:
        raise ValueError("Question is required.")

    chroma_client = PersistentClient(path="./chroma_db")
    collection_name = _to_collection_name(video_id)

    # Ensure the collection exists before searching.
    try:
        chroma_client.get_collection(collection_name)
    except Exception as exc:
        raise ValueError(
            "No processed transcript found for this video. Run /process first."
        ) from exc

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    vectorstore = Chroma(
        client=chroma_client,
        collection_name=collection_name,
        embedding_function=embeddings,
    )

    top_matches = vectorstore.similarity_search(
        query=normalized_question,
        k=4,
    )

    context_chunks = [doc.page_content.strip() for doc in top_matches if doc.page_content]
    return "\n\n".join(context_chunks)


def get_stored_transcript_chunks(video_id: str) -> list[dict[str, Any]]:
    normalized_video_id = video_id.strip()
    if not normalized_video_id:
        raise ValueError("Video ID is required.")

    chroma_client = PersistentClient(path="./chroma_db")
    collection_name = _to_collection_name(normalized_video_id)

    try:
        collection = chroma_client.get_collection(collection_name)
    except Exception as exc:
        raise ValueError(
            "No processed transcript found for this video. Run /process first."
        ) from exc

    records = collection.get(include=["documents", "metadatas"])
    raw_documents = records.get("documents") or []
    raw_metadatas = records.get("metadatas") or []

    chunks: list[dict[str, Any]] = []
    for index, chunk_text in enumerate(raw_documents):
        text = str(chunk_text or "").strip()
        if not text:
            continue

        metadata: dict[str, Any] = {}
        if index < len(raw_metadatas) and isinstance(raw_metadatas[index], dict):
            metadata = raw_metadatas[index]

        chunk_index = metadata.get("chunk_index")
        normalized_chunk_index = (
            int(chunk_index)
            if isinstance(chunk_index, int)
            else index
        )

        chunks.append(
            {
                "chunk_index": normalized_chunk_index,
                "text": text,
            }
        )

    if not chunks:
        raise ValueError("No transcript chunks found for this video.")

    chunks.sort(key=lambda item: int(item.get("chunk_index", 0)))
    return chunks

def generate_map_reduce_summary(video_id: str) -> str:
    normalized_video_id = video_id.strip()
    if not normalized_video_id:
        raise ValueError("Video ID is required.")

    chroma_client = PersistentClient(path="./chroma_db")
    collection_name = _to_collection_name(normalized_video_id)

    try:
        collection = chroma_client.get_collection(collection_name)
    except Exception as exc:
        raise ValueError(
            "No processed transcript found for this video. Run /process first."
        ) from exc

    records = collection.get(include=["documents", "metadatas"])
    raw_documents = records.get("documents") or []
    raw_metadatas = records.get("metadatas") or []

    documents: list[Document] = []
    for index, chunk_text in enumerate(raw_documents):
        text = str(chunk_text or "").strip()
        if not text:
            continue

        metadata = {}
        if index < len(raw_metadatas) and isinstance(raw_metadatas[index], dict):
            metadata = raw_metadatas[index]

        documents.append(Document(page_content=text, metadata=metadata))

    if not documents:
        raise ValueError("No transcript chunks found for this video.")

    # Keep LLM call volume bounded for free-tier rate limits on long transcripts.
    max_map_calls = max(1, int(os.getenv("SUMMARY_MAX_MAP_CALLS", "8")))
    if len(documents) > max_map_calls:
        group_size = (len(documents) + max_map_calls - 1) // max_map_calls
        grouped_documents: list[Document] = []
        for start in range(0, len(documents), group_size):
            group = documents[start:start + group_size]
            grouped_documents.append(
                Document(
                    page_content="\n\n".join(doc.page_content for doc in group),
                    metadata={"group_start": start, "group_size": len(group)},
                )
            )
        documents = grouped_documents

    openrouter_api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not openrouter_api_key:
        raise ValueError("Missing OPENROUTER_API_KEY environment variable.")

    chat_model = ChatOpenAI(
        api_key=openrouter_api_key,
        base_url="https://openrouter.ai/api/v1",
        model=os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-nano-30b-a3b:free"),
        temperature=0,
    )

    map_template = (
        "Write a concise summary of the following transcript section, "
        "extracting key terms and concepts: {text}"
    )
    reduce_template = (
        "You are an expert professor. The following is a set of summaries from a "
        "single lecture: {text}. Combine these into a comprehensive, final Study "
        "Guide formatted in Markdown. Include a High-Level Overview, Key Concepts "
        "with definitions, and Main Takeaways."
    )

    map_prompt = PromptTemplate(template=map_template, input_variables=["text"])
    reduce_prompt = PromptTemplate(template=reduce_template, input_variables=["text"])

    def _content_to_text(content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            return "\n".join(parts).strip()
        return str(content).strip()

    def _is_rate_limit_error(error_text: str) -> bool:
        lowered = error_text.lower()
        return "429" in lowered or "rate limit" in lowered

    def _extract_wait_seconds(error_text: str) -> int:
        # OpenRouter can include X-RateLimit-Reset as epoch ms in error metadata.
        match = re.search(r"X-RateLimit-Reset'\s*:\s*'?(\d+)'?", error_text)
        if not match:
            return 0

        try:
            reset_ms = int(match.group(1))
            now_ms = int(time.time() * 1000)
            delta_seconds = max(0, (reset_ms - now_ms + 999) // 1000)
            return int(min(delta_seconds, 30))
        except ValueError:
            return 0

    def _invoke_with_retry(prompt_text: str) -> str:
        max_attempts = max(1, int(os.getenv("SUMMARY_RETRY_ATTEMPTS", "4")))
        for attempt in range(max_attempts):
            try:
                response = chat_model.invoke([("human", prompt_text)])
                return _content_to_text(response.content)
            except Exception as exc:
                error_text = str(exc)
                is_last_attempt = attempt >= max_attempts - 1
                if not _is_rate_limit_error(error_text):
                    raise

                if is_last_attempt:
                    raise ValueError(
                        "OpenRouter rate limit exceeded for study-guide generation. "
                        "Wait 1-2 minutes and retry, or set OPENROUTER_MODEL to a paid/non-free model."
                    ) from exc

                wait_seconds = _extract_wait_seconds(error_text)
                if wait_seconds <= 0:
                    wait_seconds = min(20, 2 ** (attempt + 1))
                time.sleep(wait_seconds)

        raise ValueError("Failed to invoke summary model after retries.")

    def _manual_map_reduce(input_documents: list[Document]) -> str:
        map_summaries: list[str] = []
        for doc in input_documents:
            map_text = map_template.format(text=doc.page_content)
            mapped_text = _invoke_with_retry(map_text)
            if mapped_text:
                map_summaries.append(mapped_text)

        if not map_summaries:
            raise ValueError("Could not produce summaries from transcript chunks.")

        current_batch = map_summaries
        batch_size = max(2, int(os.getenv("SUMMARY_REDUCE_BATCH_SIZE", "8")))
        while len(current_batch) > 1:
            next_batch: list[str] = []
            for start in range(0, len(current_batch), batch_size):
                group = current_batch[start:start + batch_size]
                reduce_input = "\n\n".join(group)
                reduce_text = reduce_template.format(text=reduce_input)
                reduced_text = _invoke_with_retry(reduce_text)
                if reduced_text:
                    next_batch.append(reduced_text)

            if not next_batch:
                break

            current_batch = next_batch

        final_summary = current_batch[0].strip() if current_batch else ""
        if not final_summary:
            raise ValueError("Could not generate final study guide.")

        return final_summary

    try:
        summarize_module = importlib.import_module("langchain.chains.summarize")
        load_summarize_chain = getattr(summarize_module, "load_summarize_chain")

        summarize_chain = load_summarize_chain(
            llm=chat_model,
            chain_type="map_reduce",
            map_prompt=map_prompt,
            combine_prompt=reduce_prompt,
        )

        summary = summarize_chain.run(documents)
        return str(summary).strip()
    except ModuleNotFoundError:
        # Fallback when the monolithic `langchain` package is not installed.
        return _manual_map_reduce(documents)
    except Exception as exc:
        if _is_rate_limit_error(str(exc)):
            return _manual_map_reduce(documents)
        raise
