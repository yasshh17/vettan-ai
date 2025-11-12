"""
Custom callbacks for displaying agent reasoning in Streamlit
"""

from typing import Any, Dict, List, Optional
from langchain.callbacks.base import BaseCallbackHandler
import streamlit as st


class StreamlitCallbackHandler(BaseCallbackHandler):
    """
    Custom callback to display agent reasoning steps in Streamlit UI
    Shows Thought → Action → Observation loop in real-time
    """
    
    def __init__(self, container: Any) -> None:
        """
        Initialize callback handler
        
        Args:
            container: Streamlit container to render steps
        """
        super().__init__()
        self.container = container
        self.steps: List[Dict[str, Any]] = []
        self.current_step: Dict[str, Any] = {}
    
    def on_agent_action(self, action: Any, **kwargs: Any) -> None:
        """
        Called when agent decides to take an action
        
        Args:
            action: AgentAction object with tool and input
            **kwargs: Additional arguments
        """
        # Extract thought from log
        thought = ""
        if hasattr(action, 'log'):
            log_parts = str(action.log).split('Action:')
            if len(log_parts) > 0:
                thought = log_parts[0].replace('Thought:', '').strip()
        
        # Create new step
        self.current_step = {
            'type': 'action',
            'thought': thought or 'Planning next action...',
            'tool': str(action.tool) if hasattr(action, 'tool') else 'unknown',
            'input': str(action.tool_input) if hasattr(action, 'tool_input') else '',
            'observation': None
        }
        
        self.steps.append(self.current_step)
        self._render()
    
    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any
    ) -> None:
        """Called when tool execution starts"""
        pass
    
    def on_tool_end(self, output: str, **kwargs: Any) -> None:
        """
        Called when tool returns result
        
        Args:
            output: Tool output string
            **kwargs: Additional arguments
        """
        if self.current_step:
            # Truncate long observations
            truncated_output = output[:500] + "..." if len(output) > 500 else output
            self.current_step['observation'] = truncated_output
        
        self._render()
    
    def on_tool_error(self, error: Exception, **kwargs: Any) -> None:
        """
        Called when tool raises an error
        
        Args:
            error: Exception raised by tool
            **kwargs: Additional arguments
        """
        if self.current_step:
            self.current_step['observation'] = f"❌ Error: {str(error)}"
        self._render()
    
    def on_agent_finish(self, finish: Any, **kwargs: Any) -> None:
        """
        Called when agent completes
        
        Args:
            finish: AgentFinish object
            **kwargs: Additional arguments
        """
        pass
    
    def _render(self) -> None:
        """Render all steps in Streamlit"""
        with self.container:
            for i, step in enumerate(self.steps):
                # Determine emoji and title based on tool
                tool = step.get('tool', 'unknown')
                
                if tool == 'search_web':
                    emoji = "🔍"
                    action_name = "Web Search"
                elif tool == 'scrape_webpage':
                    emoji = "🌐"
                    action_name = "Scrape Article"
                else:
                    emoji = "🔧"
                    action_name = tool
                
                thought = step.get('thought', 'Processing...')
                thought_preview = thought[:60] + "..." if len(thought) > 60 else thought
                
                # Create expander for each step
                with st.expander(
                    f"{emoji} Step {i+1}: {thought_preview}",
                    expanded=(i == len(self.steps) - 1)  # Expand last step
                ):
                    # Show thought
                    st.markdown("**💭 Thought:**")
                    st.info(thought)
                    
                    # Show action
                    st.markdown(f"**⚡ Action:** `{action_name}`")
                    tool_input = step.get('input', 'N/A')
                    st.code(tool_input, language='text')
                    
                    # Show observation if available
                    observation = step.get('observation')
                    if observation:
                        st.markdown("**👁️ Observation:**")
                        
                        if observation.startswith('❌'):
                            st.error(observation)
                        else:
                            st.success(observation)