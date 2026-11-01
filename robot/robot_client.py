"""
Cliente del robot (Raspberry Pi / Jetson / PC con cámara) para FloraDetect.

- Toma fotos cada N segundos (o una sola con --once / una imagen con --file).
- Reduce la foto en el robot (máx 1280 px, JPEG 85) → envíos rápidos y servidor liviano.
- Si no hay internet, guarda la foto en una cola local y la reenvía después.
- Envía latido (heartbeat) con batería para que la web muestre "En línea".

Instalar en el robot:   pip install requests opencv-python-headless
(Raspberry Pi con cámara CSI: además  sudo apt install python3-picamera2)

Uso:
  export FLORADETECT_URL=http://IP-DEL-SERVIDOR:8000
  export FLORADETECT_KEY=fd_xxxxxxxxxxxxxxxxx
  python robot_client.py --interval 20 --plot "Lote 2"
  python robot_client.py --file hoja.jpg --wait       # prueba con una imagen
"""
import argparse
import os
import time
from pathlib import Path

import cv2
import requests

URL = os.getenv("FLORADETECT_URL", "http://localhost:8000").rstrip("/")
KEY = os.getenv("FLORADETECT_KEY", "")
QUEUE = Path(os.getenv("FLORADETECT_QUEUE", "pending_photos"))
HEADERS = {"X-Robot-Key": KEY}


def read_battery():
    """Adapta esto a tu hardware (INA219, ADC, etc.). None = no reportar."""
    return None


class Camera:
    def __init__(self, index=0):
        self.picam = None
        try:
            from picamera2 import Picamera2  # cámara CSI de Raspberry Pi
            self.picam = Picamera2()
            self.picam.configure(self.picam.create_still_configuration(main={"size": (1640, 1232)}))
            self.picam.start()
            time.sleep(1.5)  # auto-exposición
        except Exception:
            self.cap = cv2.VideoCapture(index)
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            for _ in range(5):  # descarta cuadros iniciales oscuros
                self.cap.read()

    def capture(self):
        if self.picam:
            return cv2.cvtColor(self.picam.capture_array(), cv2.COLOR_RGB2BGR)
        ok, frame = self.cap.read()
        if not ok:
            raise RuntimeError("No se pudo leer la cámara")
        return frame


def is_sharp(bgr, threshold=60.0):
    """Descarta fotos movidas (varianza del Laplaciano) para no gastar envíos."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var() >= threshold


def encode(bgr, max_side=1280):
    h, w = bgr.shape[:2]
    s = min(1.0, max_side / max(h, w))
    if s < 1:
        bgr = cv2.resize(bgr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()


def send(jpg: bytes, plot=None, lat=None, lng=None, wait=False):
    data = {"wait": str(wait).lower()}
    for k, v in {"plot_name": plot, "latitude": lat, "longitude": lng, "battery": read_battery()}.items():
        if v is not None:
            data[k] = v
    r = requests.post(f"{URL}/api/robot/analyses", headers=HEADERS, data=data,
                      files={"image": ("hoja.jpg", jpg, "image/jpeg")}, timeout=60 if wait else 20)
    r.raise_for_status()
    return r.json()


def flush_queue(plot):
    for f in sorted(QUEUE.glob("*.jpg")):
        try:
            print("↻ reenviando", f.name, send(f.read_bytes(), plot))
            f.unlink()
        except requests.RequestException:
            return  # sigue sin conexión


def send_or_queue(jpg, plot, wait=False):
    try:
        res = send(jpg, plot, wait=wait)
        print("✔", res)
        flush_queue(plot)
    except requests.HTTPError as e:
        print("✖ servidor:", e.response.status_code, e.response.text[:200])
    except requests.RequestException as e:
        QUEUE.mkdir(exist_ok=True)
        path = QUEUE / f"{int(time.time()*1000)}.jpg"
        path.write_bytes(jpg)
        print("⚠ sin conexión, guardada en cola:", path, e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=30)
    ap.add_argument("--plot", default=None)
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--file", help="enviar una imagen existente")
    ap.add_argument("--wait", action="store_true", help="esperar el resultado del análisis")
    a = ap.parse_args()
    if not KEY:
        raise SystemExit("Define FLORADETECT_KEY con la clave del robot (página Robots de la web)")

    if a.file:
        return send_or_queue(encode(cv2.imread(a.file)), a.plot, a.wait)

    cam = Camera(a.camera)
    last_beat = 0
    while True:
        frame = cam.capture()
        if is_sharp(frame):
            send_or_queue(encode(frame), a.plot, a.wait)
        else:
            print("· foto borrosa, se descarta")
        if time.time() - last_beat > 60:
            try:
                requests.post(f"{URL}/api/robot/heartbeat", headers=HEADERS,
                              data={"battery": read_battery()} if read_battery() is not None else {}, timeout=10)
                last_beat = time.time()
            except requests.RequestException:
                pass
        if a.once:
            break
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
