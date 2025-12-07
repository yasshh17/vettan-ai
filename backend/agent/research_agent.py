"""
Research agent with fallback synthesis
"""

from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_react_agent
from langchain.prompts import PromptTemplate
from typing import Dict, List, Optional, Any
import os
from dotenv import load_dotenv

from tools.search import search_web
from tools.scraper import scrape_webpage
from utils.token_tracker import get_tracker
from utils.citation_extractor import CitationExtractor
from langchain.callbacks.base import BaseCallbackHandler

class TokenAndToolHandler(BaseCallbackHandler):
    def __init__(self):
        self.search_count = 0
        self.scrape_count = 0
        self.tokens = 0
        
    def on_tool_start(self, serialized, input_str, **kwargs):
        if serialized.get("name") == "search_web":
            self.search_count += 1
        elif serialized.get("name") == "scrape_webpage":
            self.scrape_count += 1

load_dotenv()


class ResearchAgent:
    """Autonomous research agent with fallback synthesis"""
    
    REACT_PROMPT = """You are Vettan AI, an expert research assistant.

TOOLS: {tools}
TOOL NAMES: {tool_names}

FORMAT:
Question: the input question
Thought: your reasoning
Action: ONLY tool name (search_web OR scrape_webpage)
Action Input: ONLY the input (clean, no extra spaces)
Observation: tool result
... (repeat as needed)
Thought: I have enough information
Final Answer: [comprehensive answer with [Source: URL] citations]

CRITICAL: After gathering 2-3 sources, provide your Final Answer immediately!

Begin!

Question: {input}
Thought: {agent_scratchpad}"""
    
    def __init__(
        self,
        model: str = "gpt-4o-mini",
        temperature: float = 0,
        max_iterations: int = 25
    ):
        """Initialize agent"""
        self.model = model
        self.max_iterations = max_iterations
        
        self.llm = ChatOpenAI(
            model=model,
            temperature=0,
            api_key=os.getenv("OPENAI_API_KEY")
        )
        
        self.tools = [search_web, scrape_webpage]
        self.prompt = PromptTemplate.from_template(self.REACT_PROMPT)
        
        self.agent = create_react_agent(
            llm=self.llm,
            tools=self.tools,
            prompt=self.prompt
        )
        
        self.tracker = get_tracker()
    
    def research(
        self,
        query: str,
        callbacks: Optional[List] = None
    ) -> Dict[str, Any]:
        """Execute research with fallback synthesis"""
        # Create a fresh handler for THIS request
        stats_handler = TokenAndToolHandler()
        
        # Combine with existing callbacks
        request_callbacks = [stats_handler]
        if callbacks:
            request_callbacks.extend(callbacks)

        executor = AgentExecutor(
            agent=self.agent,
            tools=self.tools,
            verbose=True,
            max_iterations=self.max_iterations,
            max_execution_time=180,
            handle_parsing_errors=True,
            return_intermediate_steps=True,
            callbacks=request_callbacks
        )
        
        try:
            result = executor.invoke({"input": query})
            
            output = result.get('output', '')
            intermediate_steps = result.get('intermediate_steps', [])
            
            # FALLBACK: If agent stopped without proper answer, synthesize from gathered data
            if 'stopped due to' in output.lower() or len(output) < 100:
                print("⚠️ Agent incomplete - using fallback synthesis...")
                output = self._fallback_synthesis(query, intermediate_steps)
            
            citations = CitationExtractor.extract_from_agent_steps(intermediate_steps)
            cost_data = self.tracker.get_cost()
            
            return {
                'output': output,
                'intermediate_steps': intermediate_steps,
                'citations': citations,
                'metadata': {
                    'iterations': len(intermediate_steps),
                    'searches': stats_handler.search_count,
                    'scrapes': stats_handler.scrape_count,
                    'tokens': cost_data['total_tokens'],
                    'estimated_cost': cost_data['total_cost'],
                    'model': self.model,
                    'used_fallback': 'stopped due to' in result.get('output', '').lower()
                }
            }
        
        except Exception as e:
            return {
                'output': f"Research failed: {str(e)}",
                'intermediate_steps': [],
                'citations': [],
                'metadata': {'error': str(e)},
                'error': True
            }
    
    def _fallback_synthesis(self, query: str, intermediate_steps: List) -> str:
        """
        Emergency synthesis when agent doesn't complete
        Uses gathered data to create answer anyway
        """
        # Extract all observations
        observations = []
        for action, observation in intermediate_steps:
            obs_str = str(observation)
            if len(obs_str) > 100:
                observations.append(obs_str[:2000])
        
        if not observations:
            return "Unable to complete research. Please try again with more iterations."
        
        # Build sources text
        sources_text = ""
        for i, obs in enumerate(observations[:3]):
            sources_text += f"Source {i+1}:\n{obs}\n\n"
        
        # Synthesize from gathered data
        synthesis_prompt = f"""Based on the research data gathered, provide a comprehensive answer to this question:

Question: {query}

Research Data Gathered:
{sources_text}

Task: Synthesize this information into a clear, comprehensive answer with citations."""
        
        try:
            synthesis_llm = ChatOpenAI(
                model="gpt-4o-mini",
                temperature=0,
                api_key=os.getenv("OPENAI_API_KEY")
            )
            response = synthesis_llm.invoke(synthesis_prompt)
            
            return str(response.content)
        except Exception as e:
            print(f"❌ Fallback synthesis failed: {e}")
            return "Research data gathered but synthesis failed. Please increase Max Steps."


_agent_instance = None


def get_agent(model: str = "gpt-4o-mini", max_iterations: int = 25) -> ResearchAgent:
    """Get agent instance"""
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = ResearchAgent(model=model, max_iterations=max_iterations)
    return _agent_instance


def research(query: str, callbacks: Optional[List] = None, **kwargs: Any) -> Dict[str, Any]:
    """Research function"""
    agent = get_agent(**kwargs)
    return agent.research(query, callbacks=callbacks)