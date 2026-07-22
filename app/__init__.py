from flask import Flask
from flask_cors import CORS
from app.api.predict import predict_bp
from loguru import logger

def create_app():
    app = Flask(__name__)
    CORS(app)

    # Inicializar clasificador (mock por ahora)
    from app.model.classifier import get_classifier
    get_classifier()

    app.register_blueprint(predict_bp)

    @app.route('/')
    def index():
        return app.send_static_file('index.html')

    logger.info("FloraDetect app creada correctamente")
    return app
