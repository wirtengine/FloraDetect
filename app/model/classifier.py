
import random
from PIL import Image
from loguru import logger

class DummyClassifier:
    def __init__(self):
        self.class_names = ['Tizón tardío', 'Sana']
        logger.info("Usando clasificador simulado (modo demo)")

    def predict(self, image: Image.Image) -> dict:
        
        class_idx = random.randint(0, 1)
        confidence = round(random.uniform(0.6, 0.99), 4)
        return {
            'class': self.class_names[class_idx],
            'confidence': confidence
        }

_classifier_instance = None

def get_classifier():
    global _classifier_instance
    if _classifier_instance is None:
       
        _classifier_instance = DummyClassifier()
    return _classifier_instance
