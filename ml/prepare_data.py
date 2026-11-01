"""
Prepara el dataset 'Tomato Leaf Disease' aplicando la MISMA segmentación que usa el servidor.
Así el modelo aprende de la hoja sin fondo y en producción ve exactamente lo mismo.

Uso:
  python ml/prepare_data.py --src "/home/wirtengine/Downloads/archive/Tomato Leaf Disease"

Estructura esperada en --src:  train/<clase>/*.jpg   (y opcional valid/<clase>/*.jpg)
Si no existe 'valid', se separa un 15 % de train para validación.
Salida: ml/dataset/{train,val}/<clase>/*.jpg (cuadradas, fondo negro)
"""
import argparse
import os
import random
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.ml.segmentation import segment_leaf  # noqa: E402

EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SIZE = 256  # se guarda a 256 y el entrenamiento recorta/redimensiona a 224


def letterbox(img, size):
    h, w = img.shape[:2]
    s = size / max(h, w)
    nh, nw = max(1, int(h * s)), max(1, int(w * s))
    out = np.zeros((size, size, 3), np.uint8)
    y, x = (size - nh) // 2, (size - nw) // 2
    out[y:y + nh, x:x + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
    return out


def process(job):
    src, dst = job
    if os.path.exists(dst):
        return "skip"
    bgr = cv2.imread(src)
    if bgr is None:
        return "bad"
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    seg = segment_leaf(rgb, use_grabcut=True)
    leaf = seg.leaf_rgb if seg.found else rgb  # si falla, se usa la original
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    cv2.imwrite(dst, cv2.cvtColor(letterbox(leaf, SIZE), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
    return "ok" if seg.found else "nofound"


def list_images(folder: Path):
    return [p for p in folder.rglob("*") if p.suffix.lower() in EXTS]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", default=str(Path(__file__).parent / "dataset"))
    ap.add_argument("--val-ratio", type=float, default=0.15)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    train_dir = src / "train" if (src / "train").exists() else src
    valid_dir = next((src / d for d in ("valid", "val", "validation") if (src / d).exists()), None)
    random.seed(42)

    jobs = []
    for cls_dir in sorted(p for p in train_dir.iterdir() if p.is_dir()):
        cls = cls_dir.name
        imgs = list_images(cls_dir)
        random.shuffle(imgs)
        if valid_dir and (valid_dir / cls).exists():
            splits = {"train": imgs, "val": list_images(valid_dir / cls)}
        else:
            k = int(len(imgs) * args.val_ratio)
            splits = {"val": imgs[:k], "train": imgs[k:]}
        for split, files in splits.items():
            for f in files:
                jobs.append((str(f), str(out / split / cls / (f.stem + ".jpg"))))
        print(f"  {cls:45s} train={len(splits['train']):5d} val={len(splits['val']):5d}")

    print(f"Procesando {len(jobs)} imágenes con {args.workers} procesos…")
    stats = {}
    with ProcessPoolExecutor(args.workers) as ex:
        for i, r in enumerate(ex.map(process, jobs, chunksize=32), 1):
            stats[r] = stats.get(r, 0) + 1
            if i % 1000 == 0:
                print(f"  {i}/{len(jobs)} {stats}")
    print("Listo:", stats, "→", out)


if __name__ == "__main__":
    main()
