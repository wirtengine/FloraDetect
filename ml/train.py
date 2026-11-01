"""
Entrena el clasificador multiclase (10 clases de hoja de tomate) con MobileNetV2.
Rápido en CPU en producción (~15 MB, ~60-120 ms por imagen).

Uso:
  python ml/train.py                      # usa ml/dataset (de prepare_data.py)
  python ml/train.py --epochs 15 --fine-tune-epochs 8

Genera en backend/model_files/:
  leaf_model.keras     → el modelo
  model_meta.json      → clases, tamaño y versión (lo lee el servidor)
  training_report.txt  → métricas y matriz de confusión
"""
import argparse
import json
import os
from datetime import datetime
from pathlib import Path

import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

ROOT = Path(__file__).resolve().parents[1]
AUTOTUNE = tf.data.AUTOTUNE


def build_datasets(data_dir: Path, img: int, batch: int):
    common = dict(image_size=(img, img), batch_size=batch, label_mode="categorical", seed=42)
    train = keras.utils.image_dataset_from_directory(data_dir / "train", shuffle=True, **common)
    val = keras.utils.image_dataset_from_directory(data_dir / "val", shuffle=False, **common)
    classes = train.class_names

    # Aumento de datos: geometría + luz + color. El fondo ya es negro (segmentado).
    aug = keras.Sequential([
        layers.RandomFlip("horizontal_and_vertical"),
        layers.RandomRotation(0.2, fill_mode="constant"),
        layers.RandomZoom((-0.15, 0.1), fill_mode="constant"),
        layers.RandomTranslation(0.08, 0.08, fill_mode="constant"),
        layers.RandomBrightness(0.2, value_range=(0, 255)),
        layers.RandomContrast(0.2),
    ])
    train = train.map(lambda x, y: (aug(x, training=True), y), num_parallel_calls=AUTOTUNE)
    return train.prefetch(AUTOTUNE), val.cache().prefetch(AUTOTUNE), classes


def build_model(n_classes: int, img: int):
    inputs = keras.Input((img, img, 3))            # entrada 0..255 (el servidor envía "raw")
    x = layers.Rescaling(1 / 127.5, offset=-1)(inputs)
    base = keras.applications.MobileNetV2(include_top=False, weights="imagenet", input_tensor=x)
    base.trainable = False
    x = layers.GlobalAveragePooling2D()(base.output)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(256, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(n_classes, activation="softmax")(x)
    return keras.Model(inputs, outputs, name="floradetect_leaf"), base


def class_weights(data_dir: Path, classes):
    counts = np.array([len(os.listdir(data_dir / "train" / c)) for c in classes], dtype=float)
    w = counts.sum() / (len(classes) * counts)
    return {i: float(v) for i, v in enumerate(w)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "ml" / "dataset"))
    ap.add_argument("--out", default=str(ROOT / "backend" / "model_files"))
    ap.add_argument("--img", type=int, default=224)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--fine-tune-epochs", type=int, default=8)
    ap.add_argument("--fine-tune-layers", type=int, default=40)
    ap.add_argument("--fine-tune-lr", type=float, default=1e-5)
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()

    tf.keras.utils.set_random_seed(42)
    data, out = Path(a.data), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    model_path = out / "leaf_model.keras"

    train, val, classes = build_datasets(data, a.img, a.batch)
    print("Clases:", classes)
    cw = class_weights(data, classes)
    best_so_far = {"v": None}

    def cbs():
        return [keras.callbacks.EarlyStopping("val_accuracy", patience=4, restore_best_weights=True),
                keras.callbacks.ModelCheckpoint(str(model_path), monitor="val_accuracy", save_best_only=True,
                                                initial_value_threshold=best_so_far["v"]),
                keras.callbacks.ReduceLROnPlateau("val_loss", factor=0.3, patience=2, min_lr=1e-7)]

    loss = keras.losses.CategoricalCrossentropy(label_smoothing=0.05)

    if a.resume and model_path.exists():
        model = keras.models.load_model(model_path)
        model.compile(keras.optimizers.Adam(1e-5), loss, metrics=["accuracy"])
        best_so_far["v"] = float(model.evaluate(val, verbose=0)[1])
        print(f"Reanudando desde {model_path} (val_accuracy actual {best_so_far['v']*100:.2f}%)")
        trainable = model.layers[-(a.fine_tune_layers + 5):]
        for layer in model.layers:
            layer.trainable = False
        for layer in trainable:
            layer.trainable = not isinstance(layer, layers.BatchNormalization)
    else:
        model, base = build_model(len(classes), a.img)
        model.compile(keras.optimizers.Adam(1e-3), loss, metrics=["accuracy"])
        model.fit(train, validation_data=val, epochs=a.epochs, class_weight=cw, callbacks=cbs())
        base.trainable = True
        for layer in base.layers[:-a.fine_tune_layers]:
            layer.trainable = False
        for layer in base.layers:
            if isinstance(layer, layers.BatchNormalization):
                layer.trainable = False

    model.compile(keras.optimizers.Adam(a.fine_tune_lr), loss, metrics=["accuracy"])
    model.fit(train, validation_data=val, epochs=a.fine_tune_epochs, class_weight=cw, callbacks=cbs())

    best = keras.models.load_model(model_path)
    y_true, y_pred = [], []
    for x, y in val:
        y_true += list(np.argmax(y.numpy(), 1))
        y_pred += list(np.argmax(best.predict(x, verbose=0), 1))
    y_true, y_pred = np.array(y_true), np.array(y_pred)
    acc = float((y_true == y_pred).mean())
    cm = np.zeros((len(classes), len(classes)), int)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1

    version = f"mnv2-{len(classes)}c-{datetime.now():%Y%m%d}-acc{acc*100:.1f}"
    meta = {"classes": classes, "img_size": a.img, "input_scale": "raw", "version": version,
            "val_accuracy": acc, "trained_at": datetime.now().isoformat()}
    (out / "model_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    lines = [f"Modelo: {version}", f"Exactitud validación: {acc*100:.2f}%", "", "Por clase (precisión / recall):"]
    for i, c in enumerate(classes):
        prec = cm[i, i] / max(1, cm[:, i].sum())
        rec = cm[i, i] / max(1, cm[i].sum())
        lines.append(f"  {c:45s} {prec*100:6.2f}%  {rec*100:6.2f}%")
    lines += ["", "Matriz de confusión (filas=real, columnas=predicho):", str(cm)]
    (out / "training_report.txt").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"\n✔ Modelo en {model_path}")


if __name__ == "__main__":
    main()
