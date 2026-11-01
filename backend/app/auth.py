"""
Autenticación:
  * Usuarios web → JWT de Supabase Auth (verificado localmente, sin llamada de red).
  * Robots       → cabecera  X-Robot-Key: fd_xxxxx  (se compara su hash sha256).
"""
from __future__ import annotations

import hashlib
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status

from .config import settings
from .supabase import db

_jwks = jwt.PyJWKClient(f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json",
                        cache_keys=True) if not settings.supabase_jwt_secret else None


@dataclass
class Principal:
    user_id: str
    role: str = "operador"
    robot: dict | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


# --- caché corto de perfiles para no consultar la BD en cada petición ---
_profile_cache: dict[str, tuple[float, str]] = {}


async def _role_of(user_id: str) -> str:
    hit = _profile_cache.get(user_id)
    if hit and hit[0] > time.time():
        return hit[1]
    rows = await db.select("profiles", {"id": f"eq.{user_id}", "select": "role"})
    role = rows[0]["role"] if rows else "operador"
    _profile_cache[user_id] = (time.time() + 60, role)
    return role


def _decode(token: str) -> dict:
    try:
        if settings.supabase_jwt_secret:
            return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        key = _jwks.get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=["ES256", "RS256"], audience="authenticated")
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Token inválido: {e}")


_token_cache: dict[str, tuple[float, str]] = {}


async def _verify_remote(token: str) -> str:
    """Valida el token con Supabase Auth (sirve con llaves nuevas sb_* y legacy). Caché 5 min."""
    hit = _token_cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    r = await db.http.get(f"{db.base}/auth/v1/user", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión inválida o expirada")
    uid = r.json()["id"]
    if len(_token_cache) > 2000:
        _token_cache.clear()
    _token_cache[token] = (time.time() + 300, uid)
    return uid


async def current_user(authorization: str = Header(default="")) -> Principal:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta el token de sesión")
    token = authorization.split(" ", 1)[1]
    try:
        uid = _decode(token)["sub"]
    except HTTPException:
        uid = await _verify_remote(token)  # respaldo: pregunta a Supabase Auth
    return Principal(user_id=uid, role=await _role_of(uid))


async def require_admin(p: Principal = Depends(current_user)) -> Principal:
    if not p.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo administradores")
    return p


# --- robots ---
def new_robot_key() -> tuple[str, str, str]:
    key = "fd_" + secrets.token_urlsafe(32)
    return key, key[:10], hash_key(key)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def current_robot(x_robot_key: str = Header(default="")) -> Principal:
    if not x_robot_key.startswith("fd_"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta X-Robot-Key")
    rows = await db.select("robots", {"api_key_hash": f"eq.{hash_key(x_robot_key)}",
                                      "select": "id,owner_id,name,is_active"})
    if not rows or not rows[0]["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Robot no autorizado o desactivado")
    r = rows[0]
    return Principal(user_id=r["owner_id"], robot=r)


# --- límite de peticiones en memoria (protege el servidor) ---
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str):
    now = time.time()
    q = _hits[key]
    while q and q[0] < now - 60:
        q.popleft()
    if len(q) >= settings.rate_limit_per_min:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiadas fotos por minuto, espera un momento")
    q.append(now)
