
import os
import json
import time
import asyncio
import logging
from typing import AsyncIterator, List, Dict, Any, Optional

import httpx
from openai import AsyncOpenAI, DefaultAsyncHttpxClient

logger = logging.getLogger(__name__)

# Longer than httpx's 5s default so back-to-back queries skip the TLS handshake.
_KEEPALIVE_SECONDS = 60.0

openai_client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    http_client=DefaultAsyncHttpxClient(
        limits=httpx.Limits(
            max_connections=1000,
            max_keepalive_connections=100,
            keepalive_expiry=_KEEPALIVE_SECONDS
        )
    )
)

# Plain REST with a pooled client: the SDK opens a connection per call and has no timeout.
TAVILY_URL = "https://api.tavily.com/search"
TAVILY_INCLUDE_ANSWER = True    # Off was no faster and cited ~1 fewer source
TAVILY_CALL_TIMEOUT = 8.0
TAVILY_WAVE_DEADLINE = 6.0      # finished searches are kept when this expires

_tavily_http: Optional[httpx.AsyncClient] = None


def _get_tavily_http() -> httpx.AsyncClient:
    global _tavily_http
    if _tavily_http is None:
        _tavily_http = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=50,
                max_keepalive_connections=20,
                keepalive_expiry=_KEEPALIVE_SECONDS
            ),
            timeout=httpx.Timeout(TAVILY_CALL_TIMEOUT, connect=5.0),
            headers={"Content-Type": "application/json"}
        )
    return _tavily_http


async def warm_tavily_connections(n: int = 4) -> None:
    """Open connections during decomposition so the search wave skips the handshakes. Costs no credits."""
    client = _get_tavily_http()

    async def _ping() -> None:
        try:
            await client.get("https://api.tavily.com/", timeout=5.0)
        except Exception:
            pass  # warming is best-effort

    await asyncio.gather(*[_ping() for _ in range(n)])


DECOMPOSITION_PROMPT = """You are a search query optimizer for a world-class research assistant.

Given a research question, generate exactly 3-4 focused search queries that together will provide comprehensive, multi-angle coverage of the topic.

Rules:
- Each query must target a DIFFERENT aspect, angle, or dimension of the topic
- Keep queries concise: 3-8 words each
- Include the current year (2025) in at least one query for recency
- Prioritize queries that will surface authoritative sources (academic, government, major news)
- Output ONLY a valid JSON array of strings, nothing else

Examples:
Input: "Cancer vaccine developments"
Output: ["mRNA cancer vaccine clinical trials 2025", "personalized cancer vaccine research progress", "cancer immunotherapy combination therapy results", "ARPA-H cancer vaccine funding"]

Input: "Best AI browsers in 2025"
Output: ["AI powered web browsers 2025 review", "Arc browser AI features", "Chrome Gemini AI integration", "AI browser comparison benchmark"]

Input: "How do RAG systems work?"
Output: ["RAG retrieval augmented generation architecture explained", "RAG system components vector database", "RAG vs fine tuning LLM comparison 2025"]

Input: {query}
Output:"""


async def decompose_query(query: str) -> List[str]:
    """Split a query into 3-4 search queries, falling back to the original."""
    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": DECOMPOSITION_PROMPT.format(query=json.dumps(query))}
            ],
            temperature=0.2,
            max_tokens=200
        )

        content = response.choices[0].message.content.strip()

        if "```" in content:
            content = content.split("```")[1].replace("json", "").strip()

        parsed = json.loads(content)

        if isinstance(parsed, list) and len(parsed) >= 2:
            return parsed[:4]
        elif isinstance(parsed, dict):
            for key in parsed:
                if isinstance(parsed[key], list):
                    return parsed[key][:4]

        logger.warning(f"Unexpected decomposition format: {content}")
        return [query]

    except Exception as e:
        logger.warning(f"Query decomposition failed ({e}), using original query")
        return [query]


async def _single_search(query: str, max_results: int = 5) -> Dict[str, Any]:
    # Same body the tavily-python SDK sends.
    payload = {
        "query": query,
        "search_depth": "basic",
        "topic": "general",
        "days": 2,
        "include_answer": TAVILY_INCLUDE_ANSWER,
        "include_raw_content": False,
        "max_results": max_results,
        "include_domains": None,
        "exclude_domains": None,
        "include_images": False,
        "api_key": os.getenv("TAVILY_API_KEY"),
        "use_cache": True,
    }
    try:
        response = await _get_tavily_http().post(TAVILY_URL, json=payload)
        response.raise_for_status()
        result = response.json()
        return {
            "query": query,
            "answer": result.get("answer", ""),
            "results": result.get("results", []),
            "success": True
        }
    except Exception as e:
        logger.error(f"Search failed for '{query}': {e}")
        return {"query": query, "answer": "", "results": [], "success": False}


async def parallel_search(queries: List[str], max_results_per_query: int = 5) -> Dict[str, Any]:
    """Run searches concurrently; dedupe by URL and keep the top 8 by score."""
    tasks = [
        asyncio.create_task(_single_search(q, max_results_per_query))
        for q in queries
    ]

    done, pending = await asyncio.wait(tasks, timeout=TAVILY_WAVE_DEADLINE)
    if pending:
        logger.warning(
            f"Search deadline ({TAVILY_WAVE_DEADLINE}s): "
            f"{len(done)}/{len(tasks)} finished, dropping the rest"
        )
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    results = [
        task.result()
        for task in tasks
        if task in done and not task.cancelled() and task.exception() is None
    ]

    all_sources = []
    seen_urls = set()
    tavily_answers = []
    successful = 0

    for result in results:
        if isinstance(result, Exception) or not isinstance(result, dict):
            continue
        if result.get("success"):
            successful += 1
        if result.get("answer"):
            tavily_answers.append(result["answer"])

        for source in result.get("results", []):
            url = source.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_sources.append({
                    "title": source.get("title", ""),
                    "url": url,
                    "content": source.get("content", ""),
                    "score": source.get("score", 0),
                    "query": result.get("query", "")
                })

    all_sources.sort(key=lambda x: x.get("score", 0), reverse=True)

    return {
        "sources": all_sources[:5],
        "tavily_answers": tavily_answers,
        "successful_searches": successful,
        "total_searches": len(queries)
    }


SYNTHESIS_PROMPT = """You are Vettan, a world-class AI research assistant. Your research quality rivals ChatGPT, Claude, and Gemini. You provide comprehensive, deeply researched, well-cited answers.

Based on the search results below, write a thorough and authoritative response to the user's question.

Guidelines for world-class quality:
- Start with a concise overview paragraph summarizing the key findings
- Use clear **bold section headers** to organize different aspects of the topic
- Cite EVERY factual claim with the source: [Source: domain.com](full_url)
- Include specific facts, statistics, dates, numbers, and named entities from the sources
- If sources conflict, acknowledge both perspectives with their respective sources
- Cover the topic comprehensively — address causes, current state, implications, and future outlook where relevant
- End with a brief "Key Takeaways" section if the response covers multiple aspects
- Write with authority and precision — no hedging language like "it seems" or "perhaps"
- Be comprehensive but concise — aim for 300-500 words maximum
- Prioritize depth on the most important findings over breadth across all topics

{tavily_summary}

Search Results:
{search_context}

User Question: {query}

Comprehensive Research Response:"""


def _format_search_context(sources: List[Dict[str, Any]]) -> str:
    parts = []
    for i, source in enumerate(sources, 1):
        content = source.get("content", "")
        words = content.split()
        if len(words) > 400:
            content = " ".join(words[:400]) + "..."

        parts.append(
            f"[Source {i}] {source.get('title', 'Untitled')}\n"
            f"URL: {source.get('url', '')}\n"
            f"Content: {content}"
        )
    return "\n\n---\n\n".join(parts)


def _build_synthesis_prompt(
    query: str,
    sources: List[Dict[str, Any]],
    tavily_answers: List[str] = None
) -> str:
    tavily_summary = ""
    if tavily_answers:
        combined = " ".join(tavily_answers).strip()
        if combined:
            tavily_summary = f"Quick context from search engine: {combined}\n\n(Base your response primarily on the detailed source content below.)"

    return SYNTHESIS_PROMPT.format(
        search_context=_format_search_context(sources),
        tavily_summary=tavily_summary,
        query=query
    )


def _build_citations(sources: List[Dict[str, Any]], query: str) -> List[Dict[str, Any]]:
    return [
        {
            "url": s["url"],
            "tool": "search_web",
            "query": s.get("query", query),
            "domain": s["url"].split("/")[2] if len(s["url"].split("/")) > 2 else s["url"]
        }
        for s in sources
    ]


async def synthesize(
    query: str,
    sources: List[Dict[str, Any]],
    tavily_answers: List[str] = None
) -> str:
    prompt = _build_synthesis_prompt(query, sources, tavily_answers)

    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=1500
        )
        return response.choices[0].message.content

    except Exception as e:
        logger.error(f"Synthesis failed: {e}")
        return f"Research synthesis encountered an error: {str(e)}"


async def synthesize_stream(
    query: str,
    sources: List[Dict[str, Any]],
    tavily_answers: List[str] = None
) -> AsyncIterator[str]:
    """synthesize(), streamed as text deltas."""
    prompt = _build_synthesis_prompt(query, sources, tavily_answers)

    stream = await openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1500,
        stream=True
    )

    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    finally:
        # Closes the HTTP response if the client disconnects.
        await stream.close()


async def research_complete(query: str) -> Dict[str, Any]:
    """Decompose, search, synthesize. Returns {output, citations, metadata}."""
    start_time = time.time()

    warm_task = asyncio.create_task(warm_tavily_connections(n=4))
    sub_queries = await decompose_query(query)
    decomp_time = time.time() - start_time
    logger.info(f"[Pipeline] Decomposed in {decomp_time:.1f}s: {sub_queries}")
    if not warm_task.done():
        warm_task.cancel()  # warming is best-effort; never let it delay the search

    search_start = time.time()
    search_results = await parallel_search(queries=sub_queries, max_results_per_query=5)
    search_time = time.time() - search_start
    logger.info(
        f"[Pipeline] Search done in {search_time:.1f}s: "
        f"{search_results['successful_searches']}/{search_results['total_searches']} ok, "
        f"{len(search_results['sources'])} sources"
    )

    synthesis_start = time.time()

    if not search_results["sources"]:
        response_text = "I couldn't find relevant search results for your query. Please try rephrasing your question."
    else:
        response_text = await synthesize(
            query=query,
            sources=search_results["sources"],
            tavily_answers=search_results.get("tavily_answers", [])
        )

    synthesis_time = time.time() - synthesis_start
    total_time = time.time() - start_time

    logger.info(
        f"[Pipeline] Complete: decomp={decomp_time:.1f}s, "
        f"search={search_time:.1f}s, synthesis={synthesis_time:.1f}s, "
        f"total={total_time:.1f}s"
    )

    citations = _build_citations(search_results["sources"], query)

    return {
        "output": response_text,
        "citations": citations,
        "metadata": {
            "total_time": round(total_time, 1),
            "sources_count": len(search_results["sources"]),
            "sub_queries": sub_queries,
            "pipeline": "parallel_v2",
            "timing": {
                "decomposition": round(decomp_time, 1),
                "search": round(search_time, 1),
                "synthesis": round(synthesis_time, 1)
            }
        }
    }


async def research_stream(query: str) -> AsyncIterator[Dict[str, Any]]:
    """
    research_complete() as events:

        {"type": "stage",  "phase": "decomposed", "sub_queries": [...]}
        {"type": "sources", "citations": [...], "sources_count": n}
        {"type": "token",  "text": "..."}
        {"type": "final",  ...}  same payload as research_complete()
    """
    start_time = time.time()

    warm_task = asyncio.create_task(warm_tavily_connections(n=4))
    sub_queries = await decompose_query(query)
    decomp_time = time.time() - start_time
    logger.info(f"[Stream] Decomposed in {decomp_time:.1f}s: {sub_queries}")
    if not warm_task.done():
        warm_task.cancel()

    yield {"type": "stage", "phase": "decomposed", "sub_queries": sub_queries}

    search_start = time.time()
    search_results = await parallel_search(queries=sub_queries, max_results_per_query=5)
    search_time = time.time() - search_start
    sources = search_results["sources"]
    citations = _build_citations(sources, query)
    logger.info(
        f"[Stream] Search done in {search_time:.1f}s: "
        f"{search_results['successful_searches']}/{search_results['total_searches']} ok, "
        f"{len(sources)} sources"
    )

    yield {
        "type": "sources",
        "citations": citations,
        "sources_count": len(sources)
    }

    synthesis_start = time.time()
    ttft = None
    parts: List[str] = []

    if not sources:
        response_text = "I couldn't find relevant search results for your query. Please try rephrasing your question."
        parts.append(response_text)
        yield {"type": "token", "text": response_text}
    else:
        async for delta in synthesize_stream(
            query=query,
            sources=sources,
            tavily_answers=search_results.get("tavily_answers", [])
        ):
            if ttft is None:
                ttft = time.time() - synthesis_start
            parts.append(delta)
            yield {"type": "token", "text": delta}
        response_text = "".join(parts)

    synthesis_time = time.time() - synthesis_start
    total_time = time.time() - start_time

    logger.info(
        f"[Stream] Complete: decomp={decomp_time:.1f}s, "
        f"search={search_time:.1f}s, ttft={(ttft or 0):.1f}s, "
        f"synthesis={synthesis_time:.1f}s, total={total_time:.1f}s"
    )

    yield {
        "type": "final",
        "output": response_text,
        "citations": citations,
        "metadata": {
            "total_time": round(total_time, 1),
            "sources_count": len(sources),
            "sub_queries": sub_queries,
            "pipeline": "stream_v1",
            "timing": {
                "decomposition": round(decomp_time, 1),
                "search": round(search_time, 1),
                "synthesis": round(synthesis_time, 1),
                "ttft": round(ttft, 1) if ttft is not None else None
            }
        }
    }


def _build_followup_messages(
    query: str,
    conversation_history: List[Dict[str, str]]
) -> List[Dict[str, str]]:
    messages = [
        {
            "role": "system",
            "content": (
                "You are Vettan AI, a world-class research assistant. "
                "Answer the follow-up question based on the conversation context. "
                "Maintain the same comprehensive, well-cited quality. "
                "If the question requires new information not in the conversation, say so clearly."
            )
        }
    ]

    for msg in conversation_history[-6:]:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", "")
        })

    messages.append({"role": "user", "content": query})
    return messages


async def handle_followup(
    query: str,
    conversation_history: List[Dict[str, str]]
) -> Dict[str, Any]:
    """Answer a follow-up with one chat call instead of the full pipeline."""
    start_time = time.time()
    messages = _build_followup_messages(query, conversation_history)

    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.3,
            max_tokens=1500
        )

        total_time = time.time() - start_time

        return {
            "output": response.choices[0].message.content,
            "citations": [],
            "metadata": {
                "total_time": round(total_time, 1),
                "followup": True,
                "pipeline": "direct_llm"
            }
        }

    except Exception as e:
        logger.error(f"Follow-up failed: {e}")
        return {
            "output": f"Error handling follow-up: {str(e)}",
            "citations": [],
            "metadata": {"followup": True, "error": True}
        }


async def handle_followup_stream(
    query: str,
    conversation_history: List[Dict[str, str]]
) -> AsyncIterator[Dict[str, Any]]:
    """handle_followup() as "token" events, then a "final" event."""
    start_time = time.time()
    messages = _build_followup_messages(query, conversation_history)

    stream = await openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.3,
        max_tokens=1500,
        stream=True
    )

    parts: List[str] = []
    ttft = None
    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                if ttft is None:
                    ttft = time.time() - start_time
                parts.append(delta)
                yield {"type": "token", "text": delta}
    finally:
        await stream.close()

    total_time = time.time() - start_time
    logger.info(f"[Stream] Follow-up: ttft={(ttft or 0):.1f}s, total={total_time:.1f}s")

    yield {
        "type": "final",
        "output": "".join(parts),
        "citations": [],
        "metadata": {
            "total_time": round(total_time, 1),
            "followup": True,
            "pipeline": "direct_llm_stream",
            "timing": {"ttft": round(ttft, 1) if ttft is not None else None}
        }
    }