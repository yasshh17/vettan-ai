"""
Token usage tracking and cost estimation
"""

import tiktoken
from typing import Dict


class TokenTracker:
    """Track token usage and estimate costs"""
    
    # Pricing per 1M tokens (as of Oct 2025)
    PRICING = {
        'gpt-4o-mini': {
            'input': 0.150,   # $0.15 per 1M input tokens
            'output': 0.600   # $0.60 per 1M output tokens
        },
        'gpt-4o': {
            'input': 2.50,
            'output': 10.00
        }
    }
    
    def __init__(self, model: str = "gpt-4o-mini"):
        """
        Initialize token tracker
        
        Args:
            model: Model name for pricing
        """
        self.model = model
        self.encoding = tiktoken.encoding_for_model(model)
        self.total_input_tokens = 0
        self.total_output_tokens = 0
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text"""
        return len(self.encoding.encode(text))
    
    def add_input_tokens(self, count: int):
        """Add input token count"""
        self.total_input_tokens += count
    
    def add_output_tokens(self, count: int):
        """Add output token count"""
        self.total_output_tokens += count
    
    def get_cost(self) -> Dict[str, float]:
        """
        Calculate total cost
        
        Returns:
            Dictionary with input, output, and total costs
        """
        pricing = self.PRICING.get(self.model, self.PRICING['gpt-4o-mini'])
        
        input_cost = (self.total_input_tokens / 1_000_000) * pricing['input']
        output_cost = (self.total_output_tokens / 1_000_000) * pricing['output']
        
        return {
            'input_cost': input_cost,
            'output_cost': output_cost,
            'total_cost': input_cost + output_cost,
            'input_tokens': self.total_input_tokens,
            'output_tokens': self.total_output_tokens,
            'total_tokens': self.total_input_tokens + self.total_output_tokens
        }
    
    def reset(self):
        """Reset counters"""
        self.total_input_tokens = 0
        self.total_output_tokens = 0


# Global tracker instance
tracker = TokenTracker()


def get_tracker() -> TokenTracker:
    """Get global token tracker instance"""
    return tracker