
"""
Web scraper with URL cleaning
"""

from langchain.tools import tool
import requests
from bs4 import BeautifulSoup
import time


class WebScraper:
    """Web scraping with URL validation"""
    
    def __init__(self):
        self.scrape_count = 0
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
    
    def scrape(self, url: str, max_words: int = 800) -> str:
        """Scrape webpage content"""
        try:
            self.scrape_count += 1
            
            # CRITICAL: Strip whitespace and newlines from URL
            url = url.strip().rstrip('/').replace('\n', '').replace('\r', '')
            
            print(f"🌐 Scraping: {url[:80]}...")
            
            # Removed: artificial 1s delay was adding 5-15s total per research query
            
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'lxml')
            
            for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
                element.decompose()
            
            text = soup.get_text(separator='\n', strip=True)
            
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            text = '\n'.join(lines)
            
            words = text.split()[:max_words]
            result = ' '.join(words)
            
            return f"Content from {url}:\n\n{result}"
            
        except requests.Timeout:
            return f"Error: Timeout while scraping {url}"
        except requests.RequestException as e:
            return f"Error: Failed to scrape {url} - {str(e)}"
        except Exception as e:
            return f"Error: Unexpected error scraping {url} - {str(e)}"
    
    def get_scrape_count(self) -> int:
        """Return scrape count"""
        return self.scrape_count


scraper_instance = WebScraper()


@tool
def scrape_webpage(url: str) -> str:
    """
    Scrape webpage content.
    Use after search_web to read detailed information.
    Only scrape 2-3 most relevant URLs.
    
    Args:
        url: Full URL to scrape (will be cleaned automatically)
    
    Returns:
        Extracted text content (up to 2000 words)
    """
    # Clean URL
    url = url.strip()
    
    if not url.startswith(('http://', 'https://')):
        return f"Error: Invalid URL format: {url}"
    
    return scraper_instance.scrape(url)


__all__ = ['scrape_webpage', 'WebScraper', 'scraper_instance']
