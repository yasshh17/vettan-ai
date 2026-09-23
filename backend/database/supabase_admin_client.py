"""
Service-role Supabase client, used only for admin operations (e.g. deleting a user)
that the anon-key client used elsewhere in this app cannot perform.

Kept deliberately separate from VettanDatabaseV2 so the anon-key client used for all
normal research/history traffic can never be confused with this elevated-privilege one.
"""

from supabase import create_client, Client
import os
from typing import Optional
from dotenv import load_dotenv
import logging

logger = logging.getLogger(__name__)

load_dotenv()

_admin_client: Optional[Client] = None
_admin_client_initialized: bool = False


def get_admin_client() -> Optional[Client]:
    """
    Get a service-role Supabase client with lazy initialization.
    Returns None if SUPABASE_SERVICE_ROLE_KEY is not configured (graceful degradation).
    """
    global _admin_client, _admin_client_initialized

    if _admin_client_initialized:
        return _admin_client

    _admin_client_initialized = True

    url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not service_role_key:
        logger.warning(
            "SUPABASE_SERVICE_ROLE_KEY not configured — admin operations (e.g. account deletion) are unavailable"
        )
        _admin_client = None
        return None

    try:
        _admin_client = create_client(url, service_role_key)
        return _admin_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase admin client: {e}")
        _admin_client = None
        return None
