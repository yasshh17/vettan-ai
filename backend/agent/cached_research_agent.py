"""
Cached research with quality validation and conversation threading support
Only caches complete, successful results
"""

from agent.research_agent import research as original_research
from database.supabase_client_v2 import get_database_v2
from typing import Dict, Optional, List, Any


def cached_research(
    query: str,
    callbacks: Optional[List] = None,
    use_cache: bool = True,
    save_to_db: bool = True,  # NEW: Control whether to save (False for follow-ups)
    **kwargs: Any
) -> Dict[str, Any]:
    """Research with smart caching (only caches successful results)"""
    
    db = get_database_v2()
    
    # Check cache
    if db and use_cache:
        try:
            cached_result = db.check_cache(query)
            
            if cached_result:
                # CRITICAL: Validate cached result has actual content
                report = cached_result.get('report', '')
                
                # Don't use cache if report is incomplete
                if report and len(report) > 100 and 'stopped due to' not in report.lower():
                    print("✅ CACHE HIT - Valid result")
                    return {
                        'output': report,
                        'intermediate_steps': [],
                        'citations': cached_result.get('citations', []),
                        'metadata': {
                            **cached_result.get('metadata', {}),
                            'from_cache': True,
                            'cache_saved_cost': cached_result.get('metadata', {}).get('estimated_cost', 0.025),
                            'estimated_cost': 0,
                            'iterations': 0,
                            'session_id': cached_result.get('id')  # Include session ID from cache
                        }
                    }
                else:
                    print("⚠️ Cache HIT but result incomplete - re-researching...")
        except Exception as e:
            print(f"⚠️ Cache check failed: {e}")
    
    # Perform research
    print("🔍 Researching...")
    result = original_research(query, callbacks=callbacks, **kwargs)
    
    # CRITICAL: Only save if result is complete, valid, AND save_to_db is True
    if db and not result.get('error') and save_to_db:
        output = result.get('output', '')
        
        # Validate result quality before saving
        is_complete = (
            len(output) > 100 and
            'stopped due to' not in output.lower() and
            'research failed' not in output.lower()
        )
        
        if is_complete:
            try:
                session_id = db.save_session(
                    query=query,
                    report=output,
                    citations=result.get('citations', []),
                    metadata=result.get('metadata', {})
                )
                if session_id:
                    result['metadata']['saved_to_db'] = True
                    result['metadata']['session_id'] = session_id  # Add session ID to metadata
                    print(f"✅ Saved complete result: {session_id[:8]}")
            except Exception as e:
                print(f"⚠️ Save failed: {e}")
        else:
            print("⚠️ Result incomplete - not caching")
            result['metadata']['saved_to_db'] = False
    elif not save_to_db:
        # Follow-up query - don't save to database
        print("📝 Follow-up query - skipping database save")
        result['metadata']['saved_to_db'] = False
    
    return result