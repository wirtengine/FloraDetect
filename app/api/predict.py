
from flask import Blueprint, request, jsonify
from PIL import Image
from app.model.classifier import get_classifier
from loguru import logger

predict_bp = Blueprint('predict', __name__)

@predict_bp.route('/api/predict', methods=['POST'])
def predict():
    if 'image' not in request.files:
        return jsonify({'error': 'No se envió ninguna imagen'}), 400

    file = request.files['image']
    if file.filename == '':
        return jsonify({'error': 'Nombre de archivo vacío'}), 400

    try:
        img = Image.open(file.stream)
        classifier = get_classifier()
        result = classifier.predict(img)
        logger.info(f"Resultado: {result}")
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error en predicción: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500
