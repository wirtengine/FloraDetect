"""Flujo completo de un análisis: decodificar → analizar → guardar imágenes → reporte → notificación."""
from __future__ import annotations

import asyncio
import io

import numpy as np
from fastapi import HTTPException
from loguru import logger
from PIL import Image, ImageOps
from starlette.concurrency import run_in_threadpool

from .config import settings
from .ml.classifier import get_classifier
from .ml.diseases import info
from .supabase import db

# Cola acotada: como mucho N análisis a la vez esperando el modelo.
_pending = 0
_pending_lock = asyncio.Lock()


def decode_image(data: bytes) -> np.ndarray:
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"La imagen supera {settings.max_upload_mb} MB")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")  # respeta la orientación de la cámara
    except Exception:
        raise HTTPException(400, "El archivo no es una imagen válida")
    img.thumbnail((settings.max_image_side, settings.max_image_side), Image.LANCZOS)
    return np.asarray(img)


def to_webp(rgb: np.ndarray, quality: int = 82, max_side: int | None = None) -> bytes:
    img = Image.fromarray(rgb)
    if max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=4)
    return buf.getvalue()


async def create_record(user_id: str, source: str, robot_id: str | None, meta: dict) -> dict:
    row = {"user_id": user_id, "source": source, "robot_id": robot_id, "status": "processing",
           **{k: v for k, v in meta.items() if v not in (None, "")}}
    return (await db.insert("analyses", row))[0]


async def process(record: dict, rgb: np.ndarray, robot_name: str | None = None) -> dict:
    global _pending
    async with _pending_lock:
        if _pending >= settings.max_queue:
            await db.update("analyses", {"id": record["id"]},
                            {"status": "error", "error_message": "Servidor ocupado, reintentar"})
            raise HTTPException(503, "Servidor ocupado, intenta de nuevo en unos segundos")
        _pending += 1
    aid, uid = record["id"], record["user_id"]
    try:
        clf = get_classifier()
        res = await run_in_threadpool(clf.analyze, rgb)
        base = f"{uid}/{aid}"

        # Codificar y subir en paralelo
        files = {"image_path": (f"{base}/original.webp", res.original, 80, None),
                 "thumb_path": (f"{base}/thumb.webp", res.original, 70, 320)}
        if res.status == "done":
            files["leaf_path"] = (f"{base}/leaf.webp", res.leaf, 85, 768)
            files["heatmap_path"] = (f"{base}/heatmap.webp", res.heatmap, 85, 960)
        encoded = await run_in_threadpool(
            lambda: {k: (p, to_webp(img, q, s)) for k, (p, img, q, s) in files.items()})
        await asyncio.gather(*(db.upload(p, b) for p, b in encoded.values()))
        paths = {k: p for k, (p, _) in encoded.items()}

        values = {"status": res.status, "leaf_coverage": res.leaf_coverage,
                  "processing_ms": res.processing_ms, "model_version": clf.version, **paths}
        if res.status == "done":
            values.update(predicted_class=res.predicted_class, label=res.label, is_healthy=res.is_healthy,
                          confidence=res.confidence, health_score=res.health_score,
                          probabilities=res.probabilities, affected_area=res.affected_area,
                          severity=res.severity)
        else:
            values["error_message"] = "No se detectó una hoja en la imagen"
        updated = (await db.update("analyses", {"id": aid}, values))[0]
        await notify(updated, robot_name)
        return updated
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Fallo procesando {aid}")
        await db.update("analyses", {"id": aid}, {"status": "error", "error_message": str(e)[:300]})
        raise HTTPException(500, "Error procesando la imagen")
    finally:
        async with _pending_lock:
            _pending -= 1


async def notify(a: dict, robot_name: str | None):
    origin = f"Robot «{robot_name}»" if robot_name else "Tu foto"
    if a["status"] == "no_leaf":
        n = ("warning", "No se detectó hoja", f"{origin}: la imagen no contiene una hoja clara. Repite la toma.")
    elif a["is_healthy"]:
        n = ("success", "Hoja sana 🌱", f"{origin}: hoja sana con {a['confidence']*100:.1f}% de confianza.")
    else:
        sev = a["severity"]
        level = "danger" if sev in ("moderada", "severa") or a["predicted_class"] == "Late_blight" else "warning"
        n = (level, f"{a['label']} detectado",
             f"{origin}: {a['label']} ({a['confidence']*100:.1f}%), severidad {sev}, "
             f"{a['affected_area']*100:.0f}% de la hoja afectada. {info(a['predicted_class'])['recommendations'][0]}")
    await db.insert("notifications", {"user_id": a["user_id"], "analysis_id": a["id"],
                                      "type": n[0], "title": n[1], "body": n[2]})
