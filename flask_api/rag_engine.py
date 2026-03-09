from __future__ import annotations

import re
from typing import Any

from chromadb import PersistentClient
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
