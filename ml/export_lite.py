"""
Convierte backend/model_files/leaf_model.keras a la versión ligera para producción:
  leaf_backbone.tflite  → red convolucional (TFLite, sin TensorFlow en el servidor)
  leaf_head.npz         → capas finales en numpy (permite el mapa de calor Grad-CAM)

Uso (con el entorno .venv que tiene TensorFlow):
  python ml/export_lite.py
Al final compara el modelo original vs. el ligero con fotos de validación.
"""
import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from tensorflow import keras

ROOT = Path(__file__).resolve().parents[1]
MD = ROOT / "backend" / "model_files"


def main():
    model = keras.models.load_model(MD / "leaf_model.keras", compile=False)
    meta = json.loads((MD / "model_meta.json").read_text(encoding="utf-8"))

    idx = max(i for i, l in enumerate(model.layers) if len(l.output.shape) == 4)
    conv = model.layers[idx]
    head = []
    for l in model.layers[idx + 1:]:
        if isinstance(l, keras.layers.Dense):
            W, b = l.get_weights()
            head.append((W, b, l.activation.__name__))
        elif not isinstance(l, (keras.layers.GlobalAveragePooling2D, keras.layers.Dropout)):
            raise SystemExit(f"Capa no soportada en la cabeza: {l.__class__.__name__}")
    print(f"Última conv: {conv.name} {conv.output.shape} · cabeza: {[(h[0].shape, h[2]) for h in head]}")

    backbone = keras.Model(model.inputs, conv.output)
    conv_tfl = tf.lite.TFLiteConverter.from_keras_model(backbone)
    tfl = conv_tfl.convert()
    (MD / "leaf_backbone.tflite").write_bytes(tfl)

    arrays = {"n_layers": np.array(len(head)), "classes": np.array(meta["classes"]),
              "img_size": np.array(meta["img_size"]), "input_scale": np.array(meta["input_scale"]),
              "version": np.array(meta["version"])}
    for i, (W, b, act) in enumerate(head):
        arrays[f"W{i}"], arrays[f"b{i}"], arrays[f"act{i}"] = W, b, np.array(act)
    np.savez(MD / "leaf_head.npz", **arrays)
    print(f"✔ leaf_backbone.tflite ({len(tfl)/1e6:.1f} MB) y leaf_head.npz guardados")

    # Verificación: mismas predicciones que el modelo original
    import sys
    sys.path.insert(0, str(ROOT / "backend"))
    from app.ml.classifier import LeafClassifier
    lite = LeafClassifier.__new__(LeafClassifier)
    lite._init_lite(str(MD / "leaf_backbone.tflite"), str(MD / "leaf_head.npz"))
    val = keras.utils.image_dataset_from_directory(ROOT / "ml" / "dataset" / "val", image_size=(meta["img_size"],) * 2,
                                                   batch_size=32, shuffle=True, seed=1, label_mode=None).take(3)
    same, n, maxdiff = 0, 0, 0.0
    for batch in val:
        ref = model.predict(batch, verbose=0)
        for img, r in zip(batch.numpy(), ref):
            p, _ = lite._infer_lite(img)
            same += int(np.argmax(p) == np.argmax(r)); n += 1
            maxdiff = max(maxdiff, float(np.abs(p - r).max()))
    print(f"Coinciden {same}/{n} predicciones · diferencia máx. de probabilidad {maxdiff:.5f}")
    print("✔ Listo" if same == n else "⚠ Hay diferencias: avísale a Claude")


if __name__ == "__main__":
    main()
