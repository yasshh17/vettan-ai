"""In-memory stand-ins for the analytics privacy store and Supabase admin auth."""
from datetime import datetime, timezone


class FakePrivacyStore:
    """Same results as the RPCs, which test_analytics_sql.py runs on a real Postgres."""

    def __init__(self):
        self.consent = {}
        self.requests = {}
        self.linked = set()
        self.keys = {"id": "ok", "audit": "ok"}
        self.down = set()
        self.calls = []
        self.health_data = {}

    def _call(self, name):
        self.calls.append(name)
        if name in self.down:
            raise RuntimeError("database is down")

    def get_consent(self, user_id):
        self._call("get_consent")
        return self.consent.get(user_id)

    def get_request(self, user_id):
        self._call("get_request")
        return self.requests.get(user_id)

    def set_consent(self, user_id, granted, wording_version, source):
        self._call("set_consent")
        row = self.consent.get(user_id)
        if granted and user_id in self.requests:
            return "erasure_pending", True
        previous = bool(row and row["granted"])
        self.consent[user_id] = {
            "granted": granted, "wording_version": wording_version, "source": source,
            "erasure_completed_at": None,
        }
        if not granted and previous:
            self.requests.setdefault(user_id, self._request("withdrawal", "pending"))
        return "ok", (not granted and user_id in self.requests)

    @staticmethod
    def _request(kind, status):
        return {
            "kind": kind, "status": status, "attempts": 0, "escalated_at": None,
            "requested_at": datetime.now(timezone.utc).isoformat(),
        }

    def erase(self, user_id, actor_id, fingerprint):
        self._call("erase")
        request = self.requests.get(user_id)
        if not request or request["status"] != "pending":
            return False
        self.linked.discard(actor_id)
        request["status"] = "erased"
        if request["kind"] == "withdrawal":
            self.consent[user_id]["erasure_completed_at"] = "done"
            del self.requests[user_id]
        return True

    def mark_attempt(self, user_id, error_code):
        self._call("mark_attempt")
        self.requests[user_id]["attempts"] += 1
        self.requests[user_id]["last_error_code"] = error_code

    def mark_escalated(self, user_id, when=None):
        self._call("mark_escalated")
        self.requests[user_id]["escalated_at"] = (when or datetime.now(timezone.utc)).isoformat()

    def ack_notice(self, user_id):
        self._call("ack_notice")
        self.consent[user_id]["erasure_completed_at"] = None

    def request_account_erasure(self, user_id):
        self._call("request_account_erasure")
        row = self.consent.get(user_id)
        request = self.requests.get(user_id)
        needed = bool(row and row["granted"]) or bool(request and request["status"] == "pending")
        if row:
            row["granted"] = False
        if request:
            request["kind"] = "account"
        else:
            self.requests[user_id] = self._request("account", "pending" if needed else "erased")
        return needed

    def delete_account_content(self, user_id):
        self._call("delete_account_content")

    def open_requests(self):
        self._call("open_requests")
        return [{"user_id": user, **row} for user, row in self.requests.items()]

    def heartbeat(self, name, fingerprint):
        self._call("heartbeat")
        return self.keys[name]

    def health(self):
        self._call("health")
        return self.health_data


class FakeAdminAuth:
    def __init__(self, store):
        self.store = store
        self.deleted = []
        self.banned = []
        self.signed_out = []
        self.fail_delete = False

    def delete_user(self, user_id):
        if self.fail_delete:
            raise RuntimeError("auth is down")
        request = self.store.requests.get(user_id)
        if request and request["status"] != "erased":
            raise RuntimeError("analytics erasure is still pending")
        self.store.requests.pop(user_id, None)
        self.store.consent.pop(user_id, None)
        self.deleted.append(user_id)

    def update_user_by_id(self, user_id, attributes):
        self.banned.append((user_id, attributes))

    def sign_out(self, jwt, scope="global"):
        # Real Supabase answers 403 user_banned here.
        if self.banned:
            raise RuntimeError("user_banned")
        self.signed_out.append((jwt, scope))


class FakeAdminClient:
    def __init__(self, store):
        self.auth = type("Auth", (), {"admin": FakeAdminAuth(store)})()
