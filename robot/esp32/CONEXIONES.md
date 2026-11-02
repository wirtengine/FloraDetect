# Robot FloraDetect · 2 ESP32 · carrito 4 motores

```
                 ┌──────────────── WiFi ────────────────┐
  Teléfono / PC ─┤  http://IP-de-la-cam  (control + foto)  │
                 └───────────────────┬───────────────────┘
                                     │
                            ┌────────┴────────┐  HTTPS (foto)   floradetect-api.onrender.com
                            │   ESP32-CAM     ├───────────────► → reporte + notificación en tu web
                            │  (AI-Thinker)   │
                            └──┬──────┬───┬───┘
                        GPIO14 │ GPIO15  │ GND
                          (TX) │  (RX)   │
                               ▼   ▲     │
                     GPIO16(RX)    GPIO17(TX)  GND
                            ┌──────────────────┐
                            │  ESP32 DevKit    │──► L298N ──► motores
                            │  (movimiento)    │──► HC-SR04
                            └──────────────────┘
```

## ESP32-CAM ↔ ESP32 DevKit (UART)
| ESP32-CAM | ESP32 DevKit |
|---|---|
| GPIO14 (TX) | GPIO16 (RX2) |
| GPIO15 (RX) | GPIO17 (TX2) |
| GND | GND |

## 4 motores → L298N (2 por lado, en paralelo)
| Motores | L298N |
|---|---|
| Delantero izquierdo + trasero izquierdo | OUT1 / OUT2 (los dos juntos) |
| Delantero derecho + trasero derecho | OUT3 / OUT4 (los dos juntos) |
Si una rueda de un lado gira contraria a la otra del mismo lado, invierte SOLO los cables de esa rueda.
El L298N aguanta ~2 A por lado: con motores TT amarillos está bien.

## ESP32 DevKit → L298N
| L298N | ESP32 DevKit | Nota |
|---|---|---|
| ENA | GPIO25 | quita el jumper de ENA |
| IN1 | GPIO26 | |
| IN2 | GPIO27 | |
| ENB | GPIO14 | quita el jumper de ENB |
| IN3 | **GPIO32** | ⚠ antes GPIO12: el 12 impide que la ESP32 arranque |
| IN4 | GPIO13 | |
| GND | GND | ¡tierra común con la batería y las ESP32! |

## HC-SR04 → ESP32 DevKit
| HC-SR04 | ESP32 DevKit |
|---|---|
| VCC | 5V (VIN) |
| TRIG | GPIO18 |
| ECHO | GPIO19 **a través de divisor**: ECHO → 1 kΩ → GPIO19 → 2 kΩ → GND (ECHO da 5 V) |
| GND | GND |
Colócalo al frente, a la altura de los obstáculos.

## Alimentación (lo que más falla)
- Batería de motores: **2 pilas 18650 (7.4 V)** o 3 (11.1 V) → **12V del L298N**. Con 4 motores, pilas AA se agotan muy rápido.
- **Un regulador buck a 5 V / 2-3 A** → 5V de la ESP32-CAM y VIN de la ESP32 DevKit.
  No alimentes la ESP32-CAM desde el 5V del L298N ni del USB de la otra placa: se reinicia al arrancar motores.
- **Todas las GND unidas**: batería, buck, L298N, ESP32-CAM, ESP32 DevKit, HC-SR04.
- Condensador de 470–1000 µF entre 5V y GND cerca de la ESP32-CAM ayuda mucho.

## Cámara (HiLetgo ESP32-CAM = AI-Thinker)
- Modo solo foto: no hace video; toma la foto solo cuando se la pides y la borra de memoria al terminar de enviarla.
- 15–25 cm por encima de las hojas, apuntando hacia abajo/adelante.
- Lo ideal: una hoja ocupando buena parte de la foto (el servidor recorta la hoja y quita el fondo).
