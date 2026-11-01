"""Cliente mínimo de Supabase (PostgREST + Storage) sobre httpx con conexión reutilizada."""
from __future__ import annotations

import httpx

from .config import settings


class Supabase:
    def __init__(self):
        key = settings.supabase_service_role_key
        self.base = settings.supabase_url.rstrip("/")
        self.http = httpx.AsyncClient(
            timeout=20,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    # ---------- tablas ----------
    async def select(self, table: str, params: dict) -> list[dict]:
        r = await self.http.get(f"{self.base}/rest/v1/{table}", params=params)
        r.raise_for_status()
        return r.json()

    async def insert(self, table: str, row: dict | list) -> list[dict]:
        r = await self.http.post(f"{self.base}/rest/v1/{table}", json=row,
                                 headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()

    async def update(self, table: str, match: dict, values: dict) -> list[dict]:
        params = {k: f"eq.{v}" for k, v in match.items()}
        r = await self.http.patch(f"{self.base}/rest/v1/{table}", params=params, json=values,
                                  headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()

    async def delete(self, table: str, match: dict) -> None:
        params = {k: f"eq.{v}" for k, v in match.items()}
        r = await self.http.delete(f"{self.base}/rest/v1/{table}", params=params)
        r.raise_for_status()

    # ---------- storage ----------
    async def upload(self, path: str, data: bytes, content_type: str = "image/webp") -> str:
        r = await self.http.post(
            f"{self.base}/storage/v1/object/{settings.storage_bucket}/{path}",
            content=data, headers={"Content-Type": content_type, "x-upsert": "true",
                                   "Cache-Control": "max-age=31536000"},
        )
        r.raise_for_status()
        return path

    async def remove(self, paths: list[str]) -> None:
        if paths:
            await self.http.request("DELETE", f"{self.base}/storage/v1/object/{settings.storage_bucket}",
                                    json={"prefixes": paths})

    async def close(self):
        await self.http.aclose()


db = Supabase()
