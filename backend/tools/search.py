"""
Tavily AI Search Tool
Provides LLM-optimized web search capability for the research agent.
"""

from langchain.tools import tool
from tavily import TavilyClient
import os
from typing import Dict, List


class SearchTool:
    """Wrapper for Tavily AI search functionality"""
    
    def __init__(self, api_key: str = None):
        """
        Initialize Tavily search client
        
        Args:
            api_key: Tavily API key (defaults to env variable)
        """
        self.api_key = api_key or os.getenv("TAVILY_API_KEY")
        if not self.api_key:
            raise ValueError("TAVILY_API_KEY not found in environment")
        
        self.client = TavilyClient(api_key=self.api_key)
        self.search_count = 0
    
    def search(self, query: str, max_results: int = 10) -> str:
        """
        Search the web using Tavily AI
        
        Args:
            query: Search query string
            max_results: Maximum number of results to return
            
        Returns:
            Formatted search results as string
        """
        try:
            self.search_count += 1
            
            # Perform search
            results = self.client.search(
                query=query,
                max_results=max_results,
                search_depth="advanced",  # More comprehensive results
                include_domains=[],  # No restrictions
                exclude_domains=[]
            )
            
            # Format results for LLM consumption
            formatted_results = []
            
            if results and isinstance(results, dict):
                for i, result in enumerate(results.get('results', []), 1):
                    formatted_results.append(
                        f"Result {i}:\n"
                        f"Title: {result.get('title', 'N/A')}\n"
                        f"URL: {result.get('url', 'N/A')}\n"
                        f"Content: {result.get('content', 'N/A')[:500]}...\n"
                        f"Score: {result.get('score', 0):.2f}\n"
                    )
            
            output = "\n---\n".join(formatted_results)
            return output if output else "No results found."
            
        except Exception as e:
            return f"Search error: {str(e)}"
    
    def get_search_count(self) -> int:
        """Return total number of searches performed"""
        return self.search_count


# Create tool instance
search_tool_instance = SearchTool()


@tool
def search_web(query: str) -> str:
    """
    Search the web for current information using Tavily AI.
    Use this when you need to find recent information, sources, or articles.
    
    Args:
        query: The search query (1-10 words works best)
    
    Returns:
        Formatted search results with titles, URLs, and content snippets
    
    Example:
        query = "AI agents 2025 latest frameworks"
    """
    return search_tool_instance.search(query)


# Export for use in agent
__all__ = ['search_web', 'SearchTool', 'search_tool_instance']