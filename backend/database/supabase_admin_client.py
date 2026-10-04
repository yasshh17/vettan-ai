"""
Service-role Supabase client for admin operations. Kept separate from VettanDatabaseV2
so it can't be mistaken for the anon client used for user traffic.
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
    Service-role client, or None if not configured. Only success is cached, so a bad
    start recovers on the next call; create_client() does no network I/O.
    """
    global _admin_client, _admin_client_initialized

    if _admin_client_initialized:
        return _admin_client

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
        _admin_client_initialized = True
        return _admin_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase admin client: {e}")
        _admin_client = None
        return None
