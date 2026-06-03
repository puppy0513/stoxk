from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from .sources import DividendSnapshot


class SupabaseError(RuntimeError):
    pass


class SupabaseClient:
    def __init__(self, url: str, api_key: str) -> None:
        self.base_url = url.rstrip("/")
        self.api_key = api_key

    @classmethod
    def from_env(
        cls,
        *,
        allow_anon: bool = False,
        require_write_key: bool = False,
    ) -> "SupabaseClient":
        url = os.getenv("SUPABASE_URL", "").strip()
        write_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        anon_key = os.getenv("SUPABASE_ANON_KEY", "").strip()

        if not url:
            raise SupabaseError("SUPABASE_URL is not set")

        if require_write_key:
            key = write_key
            if not key:
                raise SupabaseError("SUPABASE_SERVICE_ROLE_KEY is not set")
        else:
            key = write_key or anon_key
            if not key:
                if allow_anon and anon_key:
                    key = anon_key
                else:
                    raise SupabaseError("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is not set")

        return cls(url, key)

    def _request(self, method: str, path: str, *, params: dict[str, object] | None = None, body: object | None = None,
                 prefer: str | None = None) -> object:
        query = f"?{urllib.parse.urlencode(params, doseq=True)}" if params else ""
        url = f"{self.base_url}/rest/v1/{path.lstrip('/')}{query}"
        headers = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer

        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read().decode("utf-8")
                if not payload:
                    return None
                return json.loads(payload)
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="ignore")
            raise SupabaseError(f"{method} {path}: HTTP {exc.code} {details}") from exc
        except urllib.error.URLError as exc:
            raise SupabaseError(f"{method} {path}: {exc.reason}") from exc

    def fetch_dividend_snapshots(self) -> list[dict[str, object]]:
        payload = self._request(
            "GET",
            "dividend_snapshots",
            params={
                "select": "stock_name,ticker,dividend,payment_day,ex_date,market,currency,source,updated_at",
                "order": "ticker",
            },
        )
        if payload is None:
            return []
        if not isinstance(payload, list):
            raise SupabaseError("Unexpected Supabase response shape")
        return payload

    def upsert_dividend_snapshots(self, snapshots: list[DividendSnapshot]) -> int:
        if not snapshots:
            return 0
        rows = [snapshot.to_supabase_row() for snapshot in snapshots]
        self._request(
            "POST",
            "dividend_snapshots",
            params={"on_conflict": "ticker"},
            body=rows,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        return len(rows)
