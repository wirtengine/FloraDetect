/*
 * FloraDetect · ESP32 de MOVIMIENTO (ESP32 DevKit normal) · carrito de 4 motores
 * (2 motores por lado conectados en paralelo: izquierdos → OUT1/OUT2, derechos → OUT3/OUT4)
 * ------------------------------------------------------------
 * - Controla 2 motores con L298N.
 * - Mide distancia con HC-SR04 (frena antes de chocar).
 * - Recibe órdenes de la ESP32-CAM por UART (Serial2):
 *     F = avanzar   B = retroceder   L = izquierda   R = derecha   S = parar
 *     A1 = modo autónomo ON   A0 = modo autónomo OFF   V180 = velocidad (0-255)
 *     K = la cámara terminó de enviar la foto
 * - En modo autónomo: avanza, se detiene, pide foto ("P"), espera "K", sigue.
 *   Si hay obstáculo: retrocede y gira.
 * - Envía telemetría a la cámara cada 300 ms:  T:<cm>,<auto 0/1>,<estado>
 *
 * Placa en Arduino IDE: "ESP32 Dev Module"  (core ESP32 de Espressif 3.x)
 */

// ===================== PINES =====================
// L298N
const int ENA = 25, IN1 = 26, IN2 = 27;   // motor izquierdo
const int ENB = 14, IN3 = 32, IN4 = 13;   // motor derecho  (IN3 pasó de GPIO12 → GPIO32: el 12 impide arrancar)
// HC-SR04  (¡ECHO da 5 V! usar divisor 1k/2k hacia GPIO19)
const int TRIG = 18, ECHO = 19;
// UART hacia la ESP32-CAM
const int LINK_RX = 16, LINK_TX = 17;

// ===================== AJUSTES =====================
// Tu robot avanzaba con DIR_AVANZAR=False → ambos motores invertidos.
// Si un motor gira al revés, cambia SOLO su valor.
const bool INVERT_LEFT  = true;
const bool INVERT_RIGHT = true;

int speedPWM = 190;                       // 0-255 (≈ tu 700/1023)
const int TURN_PWM = 220;                 // 4 ruedas: girar en el sitio necesita más fuerza
const int OBSTACLE_CM = 20;               // frena si hay algo más cerca
const unsigned long MANUAL_TIMEOUT = 700; // ms sin órdenes → se detiene (seguridad)

// Patrulla autónoma
const unsigned long DRIVE_MS = 2500;      // cuánto avanza entre fotos
const unsigned long SETTLE_MS = 700;      // espera quieto antes de la foto (evita foto movida)
const unsigned long PHOTO_TIMEOUT = 75000;// máx. espera de la cámara (Render puede estar "dormido")
const unsigned long BACK_MS = 450, TURN_MS = 600;

// ===================== ESTADO =====================
HardwareSerial Link(2);
enum Mode { MANUAL, AUTO };
enum AState { DRIVE, SETTLE, WAIT_PHOTO, AVOID_BACK, AVOID_TURN };
Mode mode = MANUAL;
AState aState = DRIVE;
unsigned long stateStart = 0, lastCmd = 0, lastTele = 0, lastPing = 0;
char manualCmd = 'S';
int distanceCm = 999;
String rx;

// ===================== MOTORES =====================
void motor(int en, int a, int b, int dir, int pwm, bool invert) {
  if (invert) dir = -dir;
  digitalWrite(a, dir > 0 ? HIGH : LOW);
  digitalWrite(b, dir < 0 ? HIGH : LOW);
  ledcWrite(en, dir == 0 ? 0 : pwm);
}
void drive(int left, int right, int pwm) {
  motor(ENA, IN1, IN2, left, pwm, INVERT_LEFT);
  motor(ENB, IN3, IN4, right, pwm, INVERT_RIGHT);
}
void stopMotors()   { drive(0, 0, 0); }
void forward()      { drive(1, 1, speedPWM); }
void backward()     { drive(-1, -1, speedPWM); }
void turnLeft()     { drive(-1, 1, TURN_PWM); }
void turnRight()    { drive(1, -1, TURN_PWM); }

// ===================== SENSOR =====================
int readDistance() {
  digitalWrite(TRIG, LOW);  delayMicroseconds(3);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 25000);   // máx ~4 m
  return us == 0 ? 999 : (int)(us / 58);
}

// ===================== MODO AUTÓNOMO =====================
void setState(AState s) { aState = s; stateStart = millis(); }

void autoStep() {
  unsigned long t = millis() - stateStart;
  switch (aState) {
    case DRIVE:
      if (distanceCm < OBSTACLE_CM) { stopMotors(); setState(AVOID_BACK); break; }
      forward();
      if (t > DRIVE_MS) { stopMotors(); setState(SETTLE); }
      break;
    case SETTLE:                       // quieto un momento → foto nítida
      stopMotors();
      if (t > SETTLE_MS) { Link.println("P"); setState(WAIT_PHOTO); }
      break;
    case WAIT_PHOTO:                   // espera "K" de la cámara (o timeout)
      stopMotors();
      if (t > PHOTO_TIMEOUT) setState(DRIVE);
      break;
    case AVOID_BACK:
      backward();
      if (t > BACK_MS) setState(AVOID_TURN);
      break;
    case AVOID_TURN:
      turnRight();
      if (t > TURN_MS) { stopMotors(); setState(DRIVE); }
      break;
  }
}

const char* stateName() {
  if (mode == MANUAL) return "MANUAL";
  switch (aState) {
    case DRIVE: return "AVANZANDO";
    case SETTLE: return "DETENIDO";
    case WAIT_PHOTO: return "FOTO";
    case AVOID_BACK: case AVOID_TURN: return "ESQUIVANDO";
  }
  return "?";
}

// ===================== ÓRDENES =====================
void handleCommand(String c) {
  c.trim();
  if (c.length() == 0) return;
  char k = c.charAt(0);
  if (k == 'A') {                                  // A1 / A0
    mode = (c == "A1") ? AUTO : MANUAL;
    stopMotors(); setState(DRIVE);
  } else if (k == 'V') {
    speedPWM = constrain(c.substring(1).toInt(), 80, 255);
  } else if (k == 'K') {                           // foto enviada
    if (mode == AUTO && aState == WAIT_PHOTO) setState(DRIVE);
  } else if (k == 'F' || k == 'B' || k == 'L' || k == 'R' || k == 'S') {
    if (mode == AUTO) { mode = MANUAL; }           // tocar un control = tomar el mando
    manualCmd = k; lastCmd = millis();
  }
}

void manualStep() {
  if (millis() - lastCmd > MANUAL_TIMEOUT) manualCmd = 'S';   // se soltó el botón / se cayó el WiFi
  switch (manualCmd) {
    case 'F': if (distanceCm < OBSTACLE_CM) stopMotors(); else forward(); break;
    case 'B': backward(); break;
    case 'L': turnLeft(); break;
    case 'R': turnRight(); break;
    default:  stopMotors();
  }
}

// ===================== SETUP / LOOP =====================
void setup() {
  Serial.begin(115200);
  Link.begin(115200, SERIAL_8N1, LINK_RX, LINK_TX);
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  ledcAttach(ENA, 1000, 8);
  ledcAttach(ENB, 1000, 8);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  stopMotors();
  Serial.println("Robot de movimiento listo");
}

void loop() {
  while (Link.available()) {                       // órdenes de la cámara
    char ch = Link.read();
    if (ch == '\n') { handleCommand(rx); rx = ""; }
    else if (rx.length() < 20) rx += ch;
  }
  while (Serial.available()) {                     // también desde el monitor serie (pruebas)
    static String s; char ch = Serial.read();
    if (ch == '\n') { handleCommand(s); s = ""; } else s += ch;
  }

  if (millis() - lastPing > 60) { distanceCm = readDistance(); lastPing = millis(); }

  if (mode == AUTO) autoStep(); else manualStep();

  if (millis() - lastTele > 300) {
    Link.printf("T:%d,%d,%s\n", distanceCm, mode == AUTO, stateName());
    lastTele = millis();
  }
}
