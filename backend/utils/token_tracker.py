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
            'input': 0.150,
            'output': 0.600
        },
        'gpt-4o': {
            'input': 2.50,
            'output': 10.00
        }
    }
    
    def __init__(self, model: str = "gpt-4o-mini"):
        self.model = model
        self.encoding = tiktoken.encoding_for_model(model)
        self.total_input_tokens = 0
        self.total_output_tokens = 0
    
    def count_tokens(self, text: str) -> int:
        return len(self.encoding.encode(text))

    def add_input_tokens(self, count: int):
        self.total_input_tokens += count

    def add_output_tokens(self, count: int):
        self.total_output_tokens += count

    def get_cost(self) -> Dict[str, float]:
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
        self.total_input_tokens = 0
        self.total_output_tokens = 0


tracker = TokenTracker()


def get_tracker() -> TokenTracker:
    return tracker