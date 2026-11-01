from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import pipeline
from .auth import Principal, current_robot, current_user, new_robot_key, rate_limit, require_admin
from .ml.diseases import DISEASES
from .supabase import db

router = APIRouter(prefix="/api")


# ------------------------------------------------------------------ info
@router.get("/health")
async def health():
    from .ml import classifier
    m = classifier._instance
    return {"ok": True, "model_loaded": m is not None, "model_version": m.version if m else None}


@router.get("/diseases")
async def diseases():
    return DISEASES


# ------------------------------------------------------------------ web
@router.post("/analyses")
async def analyze_web(image: UploadFile = File(...), plot_name: str | None = Form(None),
                      notes: str | None = Form(None), latitude: float | None = Form(None),
                      longitude: float | None = Form(None), user: Principal = Depends(current_user)):
    rate_limit(f"u:{user.user_id}")
    rgb = pipeline.decode_image(await image.read())
    rec = await pipeline.create_record(user.user_id, "web", None, {
        "plot_name": plot_name, "notes": notes, "latitude": latitude, "longitude": longitude})
    return await pipeline.process(rec, rgb)


@router.delete("/analyses/{aid}")
async def delete_analysis(aid: str, user: Principal = Depends(current_user)):
    rows = await db.select("analyses", {"id": f"eq.{aid}", "select": "*"})
    if not rows:
        raise HTTPException(404, "No existe")
    a = rows[0]
    if a["user_id"] != user.user_id and not user.is_admin:
        raise HTTPException(403, "No autorizado")
    await db.remove([a[k] for k in ("image_path", "thumb_path", "leaf_path", "heatmap_path") if a.get(k)])
    await db.delete("analyses", {"id": aid})
    return {"ok": True}


# ------------------------------------------------------------------ robot
@router.post("/robot/analyses", status_code=202)
async def analyze_robot(background: BackgroundTasks, image: UploadFile = File(...),
                        plot_name: str | None = Form(None), latitude: float | None = Form(None),
                        longitude: float | None = Form(None), battery: float | None = Form(None),
                        wait: bool = Form(False), robot: Principal = Depends(current_robot)):
    """El robot sube la foto. Por defecto responde al instante (202) y procesa en segundo plano;
    el resultado llega a la web por notificación en tiempo real. Con wait=true espera el resultado."""
    rate_limit(f"r:{robot.robot['id']}")
    rgb = pipeline.decode_image(await image.read())
    rec = await pipeline.create_record(robot.user_id, "robot", robot.robot["id"], {
        "plot_name": plot_name, "latitude": latitude, "longitude": longitude})
    seen = {"last_seen_at": datetime.now(timezone.utc).isoformat()}
    if battery is not None:
        seen["battery"] = battery
    await db.update("robots", {"id": robot.robot["id"]}, seen)
    if wait:
        a = await pipeline.process(rec, rgb, robot.robot["name"])
        return {"id": a["id"], "status": a["status"], "label": a.get("label"),
                "confidence": a.get("confidence"), "severity": a.get("severity")}

    async def run():
        try:
            await pipeline.process(rec, rgb, robot.robot["name"])
        except HTTPException:
            pass
    background.add_task(run)
    return {"id": rec["id"], "status": "processing"}


@router.post("/robot/heartbeat")
async def heartbeat(battery: float | None = Form(None), robot: Principal = Depends(current_robot)):
    vals = {"last_seen_at": datetime.now(timezone.utc).isoformat()}
    if battery is not None:
        vals["battery"] = battery
    await db.update("robots", {"id": robot.robot["id"]}, vals)
    return {"ok": True, "robot": robot.robot["name"]}


# ------------------------------------------------------------------ gestión de robots
class RobotIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: str | None = None
    location: str | None = None


async def _own_robot(rid: str, user: Principal) -> dict:
    rows = await db.select("robots", {"id": f"eq.{rid}", "select": "id,owner_id"})
    if not rows or (rows[0]["owner_id"] != user.user_id and not user.is_admin):
        raise HTTPException(404, "Robot no encontrado")
    return rows[0]


@router.post("/robots")
async def create_robot(body: RobotIn, user: Principal = Depends(current_user)):
    key, prefix, h = new_robot_key()
    row = (await db.insert("robots", {**body.model_dump(), "owner_id": user.user_id,
                                      "api_key_prefix": prefix, "api_key_hash": h}))[0]
    row.pop("api_key_hash", None)
    return {"robot": row, "api_key": key}  # la clave completa SOLO se muestra una vez


@router.post("/robots/{rid}/rotate-key")
async def rotate_key(rid: str, user: Principal = Depends(current_user)):
    await _own_robot(rid, user)
    key, prefix, h = new_robot_key()
    await db.update("robots", {"id": rid}, {"api_key_prefix": prefix, "api_key_hash": h})
    return {"api_key": key}


@router.delete("/robots/{rid}")
async def delete_robot(rid: str, user: Principal = Depends(current_user)):
    await _own_robot(rid, user)
    await db.delete("robots", {"id": rid})
    return {"ok": True}


# ------------------------------------------------------------------ admin
class RoleIn(BaseModel):
    role: str = Field(pattern="^(admin|agronomo|operador)$")


@router.patch("/admin/users/{uid}")
async def set_role(uid: str, body: RoleIn, admin: Principal = Depends(require_admin)):
    if uid == admin.user_id and body.role != "admin":
        raise HTTPException(400, "No puedes quitarte el rol de admin a ti mismo")
    rows = await db.update("profiles", {"id": uid}, {"role": body.role})
    from .auth import _profile_cache
    _profile_cache.pop(uid, None)
    return rows[0] if rows else {}
