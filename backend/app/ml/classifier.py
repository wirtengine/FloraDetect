"""
Clasificador + Grad-CAM (mapa de calor) optimizado para CPU.

- El modelo se carga UNA vez y se precalienta al iniciar el servidor.
- Inferencia y Grad-CAM en un solo paso (GradientTape sobre un submodelo).
- Compatible con:
    * el modelo nuevo multiclase (model_meta.json generado por ml/train.py)
    * el modelo viejo binario de FloraDetect (sigmoide: Sana / Tizón tardío)
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field

import cv2
import numpy as np
from loguru import logger

from .diseases import info, normalize_class
from .segmentation import lesion_fraction, segment_leaf


@dataclass
class AnalysisResult:
    status: str                         # done | no_leaf
    predicted_class: str | None = None
    label: str | None = None
    is_healthy: bool | None = None
    confidence: float | None = None
    health_score: float | None = None
    probabilities: dict = field(default_factory=dict)
    leaf_coverage: float = 0.0
    affected_area: float = 0.0
    severity: str | None = None
    processing_ms: int = 0
    # imágenes RGB uint8 para guardar
    original: np.ndarray | None = None
    leaf: np.ndarray | None = None
    heatmap: np.ndarray | None = None


def letterbox(img: np.ndarray, size: int) -> np.ndarray:
    """Redimensiona manteniendo proporción y rellena con negro (igual que en entrenamiento)."""
    h, w = img.shape[:2]
    s = size / max(h, w)
    nh, nw = max(1, int(h * s)), max(1, int(w * s))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    out = np.zeros((size, size, 3), np.uint8)
    y, x = (size - nh) // 2, (size - nw) // 2
    out[y:y + nh, x:x + nw] = resized
    return out


def severity_from(area: float, healthy: bool) -> str:
    if healthy and area < 0.10:
        return "ninguna"
    if area < 0.10:
        return "leve"
    if area < 0.30:
        return "moderada"
    return "severa"


class LeafClassifier:
    def __init__(self, model_dir: str, model_file: str):
        self._lock = threading.Lock()
        self.mode = "tf"
        lite = os.path.join(model_dir, "leaf_backbone.tflite")
        head = os.path.join(model_dir, "leaf_head.npz")
        if os.path.exists(lite) and os.path.exists(head) and os.getenv("FORCE_TF") != "1":
            self._init_lite(lite, head)
            return
        import tensorflow as tf  # import diferido: el servidor arranca rápido
        tf.config.threading.set_intra_op_parallelism_threads(int(os.getenv("TF_THREADS", "2")))
        tf.config.threading.set_inter_op_parallelism_threads(1)
        self.tf = tf

        path = os.path.join(model_dir, model_file)
        if not os.path.exists(path):  # respaldo: el modelo binario original de FloraDetect
            legacy = os.path.join(model_dir, "plant_model_best.keras")
            if os.path.exists(legacy):
                logger.warning(f"{path} no existe; usando modelo antiguo {legacy}. Entrena con ml/train.py")
                path, model_dir = legacy, "__legacy__"
        if not os.path.exists(path):
            raise FileNotFoundError(f"No se encontró el modelo en {path}")
        self.model = tf.keras.models.load_model(path, compile=False)

        meta_path = os.path.join(model_dir, "model_meta.json")
        if os.path.exists(meta_path):
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        else:  # modelo original de FloraDetect
            meta = {"classes": ["healthy", "Late_blight"], "img_size": 224,
                    "input_scale": "0_1", "version": "floradetect-v1-binario"}
        self.classes = [normalize_class(c) for c in meta["classes"]]
        self.img_size = int(meta.get("img_size", 224))
        self.input_scale = meta.get("input_scale", "0_1")
        self.version = meta.get("version", os.path.basename(path))
        self.binary = self.model.output_shape[-1] == 1

        # Submodelo: (última capa convolucional, predicción) para Grad-CAM
        conv_layer = None
        for layer in reversed(self.model.layers):
            try:
                shape = layer.output.shape
            except AttributeError:
                continue
            if len(shape) == 4 and not isinstance(layer, tf.keras.Model):
                conv_layer = layer
                break
        self.grad_model = tf.keras.Model(self.model.inputs, [conv_layer.output, self.model.output]) if conv_layer else None
        self._lock = threading.Lock()  # TF en CPU: 1 inferencia a la vez = latencia estable
        logger.info(f"Modelo {self.version} cargado · clases={self.classes} · gradcam={conv_layer.name if conv_layer else None}")
        self._warmup()

    # ---------------- modo ligero (TFLite + numpy): ~250 MB RAM, sin TensorFlow ----------------
    def _init_lite(self, lite_path: str, head_path: str):
        try:
            from ai_edge_litert.interpreter import Interpreter
        except ImportError:
            try:
                from tflite_runtime.interpreter import Interpreter
            except ImportError:
                from tensorflow.lite import Interpreter  # type: ignore
        self.mode = "lite"
        self.interp = Interpreter(model_path=lite_path, num_threads=int(os.getenv("TF_THREADS", "2")))
        self.interp.allocate_tensors()
        self.in_idx = self.interp.get_input_details()[0]["index"]
        self.out_idx = self.interp.get_output_details()[0]["index"]
        h = np.load(head_path, allow_pickle=False)
        n = int(h["n_layers"])
        self.head = [(h[f"W{i}"].astype(np.float32), h[f"b{i}"].astype(np.float32), str(h[f"act{i}"])) for i in range(n)]
        self.classes = [normalize_class(str(c)) for c in h["classes"]]
        self.img_size = int(h["img_size"])
        self.input_scale = str(h["input_scale"])
        self.version = str(h["version"]) + "-lite"
        self.binary = False
        logger.info(f"Modelo ligero {self.version} cargado · clases={self.classes}")
        self._warmup()

    def _infer_lite(self, square: np.ndarray):
        self.interp.set_tensor(self.in_idx, self._prep(square))
        self.interp.invoke()
        F = self.interp.get_tensor(self.out_idx)[0].astype(np.float32)   # (h, w, C) mapas de la última conv
        # Cabeza densa en numpy (Dropout no actúa en inferencia)
        acts = [F.mean(axis=(0, 1))]                                      # GlobalAveragePooling
        for W, b, act in self.head:
            z = acts[-1] @ W + b
            if act == "relu":
                z = np.maximum(z, 0)
            elif act == "softmax":
                e = np.exp(z - z.max()); z = e / e.sum()
            acts.append(z)
        p = acts[-1]
        c = int(np.argmax(p))
        # Grad-CAM analítico: d p_c / d(GAP) retropropagado a mano
        grad = p[c] * ((np.arange(len(p)) == c).astype(np.float32) - p)   # d p_c / d logits (softmax)
        for i in range(len(self.head) - 1, -1, -1):
            W, _, act = self.head[i]
            if act == "relu" and i != len(self.head) - 1:
                grad = grad * (acts[i + 1] > 0)
            grad = W @ grad
        cam = np.maximum((F * grad).sum(axis=-1), 0)
        cam = cam / (cam.max() + 1e-8)
        return p, cam

    def _warmup(self):
        t = time.time()
        self._infer(np.zeros((self.img_size, self.img_size, 3), np.uint8))
        logger.info(f"Precalentamiento listo en {int((time.time() - t) * 1000)} ms")

    def _prep(self, img: np.ndarray) -> np.ndarray:
        x = img.astype(np.float32)
        if self.input_scale == "0_1":
            x /= 255.0
        return x[None, ...]

    def _infer(self, square: np.ndarray):
        if self.mode == "lite":
            return self._infer_lite(square)
        tf = self.tf
        x = tf.convert_to_tensor(self._prep(square))
        if self.grad_model is None:
            return self.model(x, training=False).numpy()[0], None
        with tf.GradientTape() as tape:
            conv, preds = self.grad_model(x, training=False)
            if self.binary:
                p = preds[0, 0]
                target = tf.where(p >= 0.5, p, 1.0 - p)
            else:
                target = tf.reduce_max(preds[0])
        grads = tape.gradient(target, conv)
        weights = tf.reduce_mean(grads, axis=(1, 2))[0]
        cam = tf.nn.relu(tf.reduce_sum(conv[0] * weights, axis=-1)).numpy()
        cam = cam / (cam.max() + 1e-8)
        return preds.numpy()[0], cam

    def analyze(self, rgb: np.ndarray) -> AnalysisResult:
        t0 = time.time()
        seg = segment_leaf(rgb)
        if not seg.found:
            return AnalysisResult(status="no_leaf", original=rgb, leaf_coverage=seg.coverage,
                                  processing_ms=int((time.time() - t0) * 1000))

        square = letterbox(seg.leaf_rgb, self.img_size)
        with self._lock:
            raw, cam = self._infer(square)

        if self.binary:
            p = float(raw[0])
            probs = {self.classes[0]: 1 - p, self.classes[1]: p}
        else:
            probs = {c: float(v) for c, v in zip(self.classes, raw)}
        cls = max(probs, key=probs.get)
        healthy = cls == "healthy"

        # Área afectada medida SOLO dentro de la hoja
        x0, y0, x1, y1 = seg.crop_box
        crop = rgb[y0:y1, x0:x1]
        mask = seg.mask[y0:y1, x0:x1]
        area, lesion = lesion_fraction(crop, mask)

        heat = self._heatmap(crop, mask, lesion, cam, healthy)
        meta = info(cls)
        return AnalysisResult(
            status="done", predicted_class=cls, label=meta["label"], is_healthy=healthy,
            confidence=round(probs[cls], 4), health_score=round(probs.get("healthy", 0.0), 4),
            probabilities={k: round(v, 4) for k, v in sorted(probs.items(), key=lambda kv: -kv[1])},
            leaf_coverage=round(seg.coverage, 4), affected_area=round(area, 4),
            severity=severity_from(area, healthy),
            processing_ms=int((time.time() - t0) * 1000),
            original=rgb, leaf=seg.leaf_rgb, heatmap=heat,
        )

    def _heatmap(self, crop, mask, lesion, cam, healthy) -> np.ndarray:
        h, w = crop.shape[:2]
        leaf = (mask > 0).astype(np.float32)
        lesion_soft = cv2.GaussianBlur(lesion.astype(np.float32) / 255.0, (0, 0), max(3, w // 60))
        if cam is not None:
            # El CAM se calculó sobre el cuadrado con letterbox: deshacemos el relleno
            s = self.img_size / max(h, w)
            nh, nw = int(h * s), int(w * s)
            oy, ox = (self.img_size - nh) // 2, (self.img_size - nw) // 2
            cam_sq = cv2.resize(cam, (self.img_size, self.img_size), interpolation=cv2.INTER_CUBIC)
            cam_crop = cv2.resize(cam_sq[oy:oy + nh, ox:ox + nw], (w, h), interpolation=cv2.INTER_CUBIC)
            heat = 0.6 * cam_crop + 0.4 * lesion_soft if not healthy else 0.3 * cam_crop + 0.7 * lesion_soft
        else:
            heat = lesion_soft
        heat = np.clip(heat * leaf, 0, None)  # el fondo NUNCA se marca
        heat = heat / (heat.max() + 1e-8)

        colored = cv2.applyColorMap((heat * 255).astype(np.uint8), cv2.COLORMAP_JET)
        colored = cv2.cvtColor(colored, cv2.COLOR_BGR2RGB)
        base = crop.astype(np.float32)
        base = base * (0.35 + 0.65 * leaf[..., None])  # oscurece el fondo
        alpha = (0.55 * heat * leaf)[..., None]
        out = (base * (1 - alpha) + colored * alpha).astype(np.uint8)

        # Contorno de la hoja y de la zona más afectada
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(out, cnts, -1, (255, 255, 255), max(1, w // 300))
        if not healthy:
            hot = (heat > 0.6).astype(np.uint8) * 255
            hc, _ = cv2.findContours(hot, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            hc = sorted(hc, key=cv2.contourArea, reverse=True)[:3]
            cv2.drawContours(out, hc, -1, (255, 40, 40), max(2, w // 200))
        return out


_instance: LeafClassifier | None = None
_init_lock = threading.Lock()


def get_classifier() -> LeafClassifier:
    global _instance
    if _instance is None:
        with _init_lock:
            if _instance is None:
                from ..config import settings
                _instance = LeafClassifier(settings.model_dir, settings.model_file)
    return _instance
