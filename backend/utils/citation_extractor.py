"""
Extract and format citations from agent research
"""

import re
from typing import List, Dict
from urllib.parse import urlparse


class CitationExtractor:
    """Extract URLs and create citation list from agent output"""
    
    @staticmethod
    def extract_urls(text: str) -> List[str]:
        url_pattern = r'https?://[^\s\)\]\}]+'
        urls = re.findall(url_pattern, text)

        seen = set()
        unique_urls = []
        for url in urls:
            if url not in seen:
                seen.add(url)
                unique_urls.append(url)
        
        return unique_urls
    
    @staticmethod
    def extract_from_agent_steps(intermediate_steps: List) -> List[Dict[str, str]]:
        citations = []
        seen_urls = set()

        for action, observation in intermediate_steps:
            urls = CitationExtractor.extract_urls(str(observation))

            for url in urls:
                if url not in seen_urls:
                    seen_urls.add(url)

                    parsed = urlparse(url)
                    domain = parsed.netloc
                    
                    citations.append({
                        'url': url,
                        'domain': domain,
                        'tool': action.tool if hasattr(action, 'tool') else 'unknown',
                        'query': str(action.tool_input)[:100] if hasattr(action, 'tool_input') else ''
                    })
        
        return citations
    
    @staticmethod
    def format_citations(citations: List[Dict[str, str]]) -> str:
        if not citations:
            return "No external sources cited."
        
        formatted = []
        for i, cite in enumerate(citations, 1):
            formatted.append(f"{i}. [{cite['domain']}]({cite['url']})")
        
        return "\n".join(formatted)