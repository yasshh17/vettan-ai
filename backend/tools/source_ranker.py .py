
"""
Rank sources by authority and relevance
"""

class SourceRanker:
    """
    Ranks sources using multiple signals:
    - Domain authority (.edu, .gov, Nature, Science, ArXiv)
    - Citation count (academic papers)
    - Recency (prefer 2024-2025)
    - Content relevance (embedding similarity)
    """
    
    DOMAIN_SCORES = {
        '.edu': 10,
        '.gov': 10,
        'nature.com': 10,
        'science.org': 10,
        'arxiv.org': 9,
        'nber.org': 9,
        'brookings.edu': 8,
        'mit.edu': 10,
        'stanford.edu': 10,
        'technologyreview.com': 7,
        'hbr.org': 7,
        'medium.com': 3,
        'reddit.com': 2
    }
    
    def rank_sources(self, sources: List[Dict], query: str) -> List[Dict]:
        """
        Rank sources by quality score
        
        Score = domain_authority * recency_factor * relevance_score
        """
        scored = []
        
        for source in sources:
            domain_score = self._get_domain_score(source['url'])
            recency_score = self._get_recency_score(source.get('published_date'))
            relevance_score = source.get('score', 0.5)  # From Tavily
            
            total_score = domain_score * recency_score * relevance_score
            
            scored.append({
                **source,
                'quality_score': total_score
            })
        
        # Sort by quality score
        ranked = sorted(scored, key=lambda x: x['quality_score'], reverse=True)
        
        return ranked
    
    def _get_domain_score(self, url: str) -> float:
        """Score based on domain authority"""
        for domain, score in self.DOMAIN_SCORES.items():
            if domain in url:
                return score / 10.0  # Normalize to 0-1
        return 0.5  # Default