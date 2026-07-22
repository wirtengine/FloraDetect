import os
import numpy as np
import cv2
from PIL import Image
from loguru import logger
import tensorflow as tf

class PlantClassifier:
    def __init__(self, model_path: str):
        self.model = tf.keras.models.load_model(model_path)
        self.class_names = ['Sana', 'Tizón tardío']
        self.img_size = (224, 224)
        logger.info(f"Modelo cargado desde {model_path}")

    def remove_background(self, image: Image.Image) -> Image.Image:
        opencv_image = cv2.cvtColor(np.array(image.convert('RGB')), cv2.COLOR_RGB2BGR)
        hsv = cv2.cvtColor(opencv_image, cv2.COLOR_BGR2HSV)

        lower_green = np.array([30, 30, 30])
        upper_green = np.array([90, 255, 255])

        mask = cv2.inRange(hsv, lower_green, upper_green)

        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        background = np.full_like(opencv_image, 128)
        result = np.where(mask[:, :, None] == 255, opencv_image, background)

        result_rgb = cv2.cvtColor(result, cv2.COLOR_BGR2RGB)
        return Image.fromarray(result_rgb)

    def predict(self, image: Image.Image) -> dict:
        clean_image = self.remove_background(image)

        img = clean_image.resize(self.img_size)
        img_array = np.array(img, dtype=np.float32) / 255.0
        img_array = np.expand_dims(img_array, axis=0)

        preds = self.model.predict(img_array, verbose=0)[0][0]
        class_idx = 1 if preds >= 0.5 else 0
        confidence = float(preds) if class_idx == 1 else float(1 - preds)

        return {
            'class': self.class_names[class_idx],
            'confidence': round(confidence, 4)
        }

_classifier_instance = None

def get_classifier():
    global _classifier_instance
    if _classifier_instance is None:
        model_path = os.path.join('model_files', 'plant_model_best.keras')
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"No se encontró el modelo en {model_path}")
        _classifier_instance = PlantClassifier(model_path)
    return _classifier_instance