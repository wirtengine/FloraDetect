import os
import sys
import requests
import cv2
import numpy as np
from dotenv import load_dotenv
from datetime import datetime

# Cargar variables de entorno
load_dotenv()

CAM_URL = os.getenv("CAM_URL")
if not CAM_URL:
    print("Error: CAM_URL no está definido en el archivo .env")
    sys.exit(1)

def capturar_y_validar(url, guardar_en="data/capturas", mostrar=False):
    """
    Captura una imagen desde una URL, la guarda en disco y la valida.
    """
    try:
        print(f"Conectando a la cámara: {url}")
        respuesta = requests.get(url, timeout=10)
        respuesta.raise_for_status()
        
        # Convertir bytes a imagen OpenCV para validar que sea una imagen real
        imagen_bytes = np.frombuffer(respuesta.content, np.uint8)
        imagen = cv2.imdecode(imagen_bytes, cv2.IMREAD_COLOR)
        
        if imagen is None:
            raise ValueError("El contenido no es una imagen válida")
        
        # Crear carpeta si no existe
        os.makedirs(guardar_en, exist_ok=True)
        
        # Generar nombre único con timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        nombre_archivo = f"captura_{timestamp}.jpg"
        ruta_completa = os.path.join(guardar_en, nombre_archivo)
        
        # Guardar la imagen
        cv2.imwrite(ruta_completa, imagen)
        print(f"✅ Imagen guardada correctamente: {ruta_completa}")
        print(f"   Dimensiones: {imagen.shape[1]}x{imagen.shape[0]} píxeles")
        
        # Mostrar la imagen si se solicita (solo si hay entorno gráfico)
        if mostrar:
            cv2.imshow("Captura de prueba", imagen)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
            
    except requests.exceptions.ConnectionError:
        print(f"❌ Error: No se pudo conectar a la cámara. ¿El teléfono está encendido y en la misma red WiFi?")
        print(f"   URL: {url}")
    except requests.exceptions.Timeout:
        print(f"❌ Error: Tiempo de espera agotado. La cámara no responde.")
    except ValueError as ve:
        print(f"❌ Error: {ve}")
    except Exception as e:
        print(f"❌ Error inesperado: {e}")

if __name__ == "__main__":
    # Por defecto guardamos en data/capturas y no mostramos la ventana
    # Si quieres ver la imagen, cambia mostrar=True
    capturar_y_validar(CAM_URL, guardar_en="data/capturas", mostrar=False)