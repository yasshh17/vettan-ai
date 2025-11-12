
"""Enhanced research with query decomposition"""

from .cached_research_agent import cached_research
from langchain_openai import ChatOpenAI
from typing import List, Dict, Any
import os


def research_with_decomposition(
    query: str,
    auto_decompose: bool = True,
    **kwargs: Any
) -> Dict[str, Any]:
    """Enhanced research with automatic decomposition"""
    
    word_count = len(query.split())
    complex_keywords = [
        'analyze', 'evaluate', 'implications', 'comprehensive',
        'compare', 'contrast', 'assess', 'examine'
    ]
    
    is_complex = word_count > 15 or any(kw in query.lower() for kw in complex_keywords)
    
    if not is_complex or not auto_decompose:
        return cached_research(query, **kwargs)
    
    print(f"🧠 Complex query ({word_count} words). Decomposing...")
    
    # Decompose - FIXED: api_key parameter
    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0,
        api_key=os.getenv("OPENAI_API_KEY")  # FIXED
    )
    
    prompt = f"""Break this into 3-4 sub-questions:

Query: {query}

Sub-questions:"""
    
    response = llm.invoke(prompt)
    
    lines = str(response.content).strip().split('\n')
    sub_queries: List[str] = []
    
    for line in lines:
        cleaned = line.strip().lstrip('0123456789.- ')
        if len(cleaned) > 10:
            sub_queries.append(cleaned)
    
    sub_queries = sub_queries[:4]
    
    # Research each
    sub_results: List[Dict[str, Any]] = []
    all_citations: List[Dict[str, Any]] = []
    
    for sub_q in sub_queries:
        result = cached_research(sub_q, max_iterations=8, **kwargs)
        
        sub_results.append({
            'query': sub_q,
            'report': result['output'],
            'citations': result.get('citations', [])
        })
        
        citations_list = result.get('citations', [])
        if isinstance(citations_list, list):
            all_citations.extend(citations_list)
    
    # Synthesize - FIXED: api_key parameter
    synthesis_llm = ChatOpenAI(
        model="gpt-4o",
        temperature=0,
        api_key=os.getenv("OPENAI_API_KEY")  # FIXED
    )
    
    sub_reports = "\n\n".join([
        f"### {i+1}. {r['query']}\n{r['report']}"
        for i, r in enumerate(sub_results)
    ])
    
    prompt = f"""Synthesize into comprehensive report.

Original: {query}

Research:
{sub_reports}

Task: Create comprehensive report."""
    
    synthesis = synthesis_llm.invoke(prompt)
    
    # Deduplicate citations
    unique_citations: List[Dict[str, Any]] = []
    seen: set = set()
    
    for cite in all_citations:
        url = cite.get('url', '')
        if url and url not in seen:
            seen.add(url)
            unique_citations.append(cite)
    
    return {
        'output': str(synthesis.content),
        'citations': unique_citations,
        'metadata': {
            'decomposed': True,
            'sub_queries_count': len(sub_queries),
            'total_sources': len(unique_citations),
            'synthesis_model': 'gpt-4o'
        }
    }
