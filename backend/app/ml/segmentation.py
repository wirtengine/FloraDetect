"""
Segmentación de la hoja: aísla la hoja y elimina el fondo para que el modelo
analice SOLO la hoja (no la tierra, el cielo, la mano, etc.).

Mejoras respecto a la versión anterior (que solo tomaba el color verde):
  * El rango verde eliminaba las manchas marrones/amarillas de la enfermedad,
    justo lo que el modelo necesita ver. Ahora se incluyen verdes, amarillos y
    marrones de la hoja y luego se RELLENAN los huecos internos del contorno.
  * Se usa el índice de verdor ExG (2G - R - B) + Otsu, robusto a iluminación.
  * Se queda solo con el objeto más grande (la hoja) y descarta ruido.
  * Refinado opcional con GrabCut sobre una imagen reducida (rápido).
  * Recorta a la caja de la hoja con margen → la hoja ocupa todo el encuadre.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

WORK_SIZE = 384  # resolución de trabajo para la máscara (rápido en CPU)


@dataclass
class LeafSegmentation:
    mask: np.ndarray        # uint8 0/255, tamaño de la imagen original
    leaf_rgb: np.ndarray    # imagen recortada con fondo neutro (RGB)
    crop_box: tuple         # (x0, y0, x1, y1) en la imagen original
    coverage: float         # fracción de la imagen que es hoja
    found: bool


def _exg_mask(rgb: np.ndarray) -> np.ndarray:
    f = rgb.astype(np.float32)
    s = f.sum(axis=2) + 1e-6
    r, g, b = f[..., 0] / s, f[..., 1] / s, f[..., 2] / s
    exg = 2 * g - r - b
    exg = cv2.normalize(exg, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    exg = cv2.GaussianBlur(exg, (5, 5), 0)
    _, m = cv2.threshold(exg, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return m


def _hsv_mask(rgb: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    # verde sano
    green = cv2.inRange(hsv, (25, 35, 25), (95, 255, 255))
    # amarillo / clorosis
    yellow = cv2.inRange(hsv, (12, 60, 60), (35, 255, 255))
    # marrón / necrosis (oscuro y poco brillante pero saturado)
    brown = cv2.inRange(hsv, (0, 50, 20), (25, 255, 200))
    return green, cv2.bitwise_or(yellow, brown)


def _largest_component(mask: np.ndarray) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return mask
    idx = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return np.where(labels == idx, 255, 0).astype(np.uint8)


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, contours, -1, 255, thickness=cv2.FILLED)
    return filled


def segment_leaf(rgb: np.ndarray, use_grabcut: bool = True, pad: float = 0.06) -> LeafSegmentation:
    h, w = rgb.shape[:2]
    scale = WORK_SIZE / max(h, w)
    small = cv2.resize(rgb, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]

    green, lesion_colors = _hsv_mask(small)
    exg = _exg_mask(small)
    seed = cv2.bitwise_or(green, exg)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    seed = cv2.morphologyEx(seed, cv2.MORPH_OPEN, k, iterations=1)
    seed = _largest_component(seed)

    # Añadimos amarillos/marrones SOLO si tocan la hoja (lesiones), no el suelo
    near_leaf = cv2.dilate(seed, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    mask = cv2.bitwise_or(seed, cv2.bitwise_and(lesion_colors, near_leaf))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    mask = _largest_component(mask)
    mask = _fill_holes(mask)

    coverage = float(mask.mean() / 255.0)

    # GrabCut refina los bordes cuando el fondo es complejo (campo real)
    if use_grabcut and 0.03 < coverage < 0.95:
        gc = np.full((sh, sw), cv2.GC_PR_BGD, np.uint8)
        gc[cv2.dilate(mask, k, iterations=4) == 0] = cv2.GC_BGD
        gc[mask > 0] = cv2.GC_PR_FGD
        gc[cv2.erode(mask, k, iterations=4) > 0] = cv2.GC_FGD
        try:
            bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
            cv2.grabCut(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), gc, None, bgd, fgd, 2, cv2.GC_INIT_WITH_MASK)
            refined = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
            refined = _fill_holes(_largest_component(refined))
            if refined.mean() / 255.0 > coverage * 0.5:
                mask = refined
                coverage = float(mask.mean() / 255.0)
        except cv2.error:
            pass

    found = coverage >= 0.03
    mask_full = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
    if not found:
        return LeafSegmentation(mask_full, rgb, (0, 0, w, h), coverage, False)

    ys, xs = np.where(mask_full > 0)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    px, py = int((x1 - x0) * pad), int((y1 - y0) * pad)
    x0, y0 = max(0, x0 - px), max(0, y0 - py)
    x1, y1 = min(w, x1 + px + 1), min(h, y1 + py + 1)

    # Suaviza el borde para no crear un corte artificial que el modelo aprenda
    soft = cv2.GaussianBlur(mask_full, (7, 7), 0).astype(np.float32)[..., None] / 255.0
    background = np.zeros_like(rgb)  # fondo negro: igual que en el entrenamiento
    leaf = (rgb * soft + background * (1 - soft)).astype(np.uint8)
    leaf = leaf[y0:y1, x0:x1]
    return LeafSegmentation(mask_full, leaf, (x0, y0, x1, y1), coverage, True)


def lesion_fraction(rgb: np.ndarray, mask: np.ndarray) -> tuple[float, np.ndarray]:
    """Porcentaje de la hoja con lesiones (amarillo, marrón, necrosis, manchas)."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hch, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    healthy_green = (hch >= 35) & (hch <= 90) & (s >= 50) & (v >= 40)
    leaf = mask > 0
    lesion = leaf & ~healthy_green
    lesion = cv2.morphologyEx(lesion.astype(np.uint8) * 255, cv2.MORPH_OPEN,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    # ignora el borde fino de la hoja (suele ser sombra/halo)
    inner = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    lesion = cv2.bitwise_and(lesion, inner)
    leaf_px = max(1, int(leaf.sum()))
    return float((lesion > 0).sum() / leaf_px), lesion
