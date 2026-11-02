/*
 * FloraDetect · ESP32-CAM (HiLetgo / AI-Thinker, OV2640) · MODO SOLO FOTO
 * ------------------------------------------------------------
 * CONFIGURACIÓN DESDE EL TELÉFONO (sin recompilar):
 *   1. Enciende el robot. Si no conoce ningún WiFi, conéctate desde el teléfono a la red
 *      "FloraRobot"  (clave: flora1234). Se abre sola la página de configuración
 *      (si no se abre, entra a http://192.168.4.1/setup).
 *   2. Elige tu WiFi, escribe la clave, pega la clave del robot (fd_...) → Guardar.
 *   3. El robot se reinicia, se conecta y avisa su dirección a FloraDetect:
 *      en flora-detect.vercel.app → Robots aparece el botón "Abrir control".
 *      También funciona  http://florarobot.local  (iPhone / PC).
 *   La red "FloraRobot" queda SIEMPRE disponible: aunque no haya internet puedes manejar el robot
 *   en http://192.168.4.1 y cambiar la configuración en ⚙️.
 *
 * - La cámara está QUIETA hasta recibir una orden (botón 📷 o "P" del modo autónomo).
 * - Toma UNA foto → la envía directo desde el buffer (sin copias) → libera la memoria.
 *
 * Arduino IDE → Placa: "AI Thinker ESP32-CAM" · PSRAM: Enabled
 * Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)"
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ===================== FIJO (no hace falta cambiar) =====================
const char* SERVER_URL = "https://floradetect-api.onrender.com";
const char* AP_SSID = "FloraRobot";          // red propia del robot (siempre activa)
const char* AP_PASS = "flora1234";           // mínimo 8 caracteres
const char* MDNS_NAME = "florarobot";        // → http://florarobot.local
// ========================================================================

// Pines cámara AI-Thinker (HiLetgo usa los mismos)
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22
#define FLASH_LED 4

// UART hacia la ESP32 de motores
#define LINK_TX 14
#define LINK_RX 15
HardwareSerial Link(1);

// Configuración guardada en la memoria (NVS): sobrevive a apagados
Preferences prefs;
String cfgSsid, cfgPass, cfgKey, cfgPlot;

httpd_handle_t webServer = NULL;
DNSServer dns;
SemaphoreHandle_t netLock;                     // una sola conexión HTTPS a la vez
volatile bool useFlash = false;
volatile bool restartPending = false;
String telemetry = "999,0,MANUAL";
String lastResult = "Aún no se ha enviado ninguna foto";
String serverStatus = "sin comprobar";
uint32_t photosSent = 0;
bool mdnsStarted = false;
String lineBuf;

static const char PAGE[] PROGMEM = R"HTML(
<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>FloraDetect Robot</title>
<style>
:root{--g:#305d20;--g2:#4f9530;--bg:#f6f1e7;--t:#e5502d}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:#10200a}
header{background:var(--g);color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
h1{font-size:18px;margin:0}.pill{background:#ffffff22;border-radius:99px;padding:3px 10px;font-size:12px}
main{max-width:480px;margin:auto;padding:12px}
.card{background:#fff;border-radius:16px;padding:14px;box-shadow:0 4px 16px #10200a14;margin-top:12px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}
.stats b{display:block;font-size:20px}.stats small{color:#10200a99;font-size:11px;text-transform:uppercase}
.row{display:flex;gap:10px;margin-top:12px}
.big{flex:1;border:0;border-radius:14px;padding:16px;font-size:16px;font-weight:700;color:#fff;background:var(--g)}
.big.auto{background:#7a5a12}.big.auto.on{background:var(--t)}.big:disabled{opacity:.5}
.pad{display:grid;grid-template-columns:repeat(3,76px);grid-template-rows:repeat(3,76px);gap:8px;justify-content:center;margin:6px 0 14px}
.pad button{font-size:28px;border:0;border-radius:16px;background:#e3efd9;color:var(--g);touch-action:none;user-select:none}
.pad button.on{background:var(--g2);color:#fff}.pad .stop{background:#fde2dc;color:var(--t);font-size:16px;font-weight:700}
label{font-size:13px;display:flex;align-items:center;gap:8px;margin-top:8px}
input[type=range]{flex:1;accent-color:var(--g2)}
#res{font-size:14px;line-height:1.4}
</style></head><body>
<header><h1>🍃 FloraDetect Robot</h1><span><span class="pill" id="mode">MANUAL</span> <a href="/setup" style="color:#fff;text-decoration:none;font-size:20px;margin-left:6px">⚙️</a></span></header>
<main>
 <div class="card stats">
  <div><b id="dist">—</b><small>Distancia</small></div>
  <div><b id="state">—</b><small>Estado</small></div>
  <div><b id="sent">0</b><small>Fotos</small></div>
 </div>
 <div class="row">
  <button class="big" id="photo">📷 Tomar foto</button>
  <button class="big auto" id="auto">🤖 Autónomo</button>
 </div>
 <div class="card"><div id="res">Listo.</div><div id="net" style="font-size:12px;color:#10200a99;margin-top:8px"></div></div>
 <div class="card">
  <div class="pad">
   <span></span><button data-c="F">▲</button><span></span>
   <button data-c="L">◀</button><button class="stop" data-c="S">STOP</button><button data-c="R">▶</button>
   <span></span><button data-c="B">▼</button><span></span>
  </div>
  <label>Velocidad <input type="range" id="spd" min="80" max="255" value="190"></label>
  <label><input type="checkbox" id="flash"> Usar flash al tomar la foto</label>
 </div>
</main>
<script>
const $=id=>document.getElementById(id);
const send=c=>fetch('/cmd?c='+c).catch(()=>{});
let timer=null,busy=false,auto=false;
document.querySelectorAll('.pad button').forEach(b=>{
  const c=b.dataset.c;
  const start=e=>{e.preventDefault();b.classList.add('on');send(c);clearInterval(timer);if(c!=='S')timer=setInterval(()=>send(c),250)};
  const end=()=>{b.classList.remove('on');clearInterval(timer);timer=null;send('S')};
  b.addEventListener('pointerdown',start);b.addEventListener('pointerup',end);
  b.addEventListener('pointerleave',()=>timer&&end());b.addEventListener('pointercancel',end);
});
document.addEventListener('keydown',e=>{const k={ArrowUp:'F',ArrowDown:'B',ArrowLeft:'L',ArrowRight:'R',' ':'S'}[e.key];if(k&&!e.repeat)send(k)});
document.addEventListener('keyup',e=>{if(e.key.startsWith('Arrow'))send('S')});
$('spd').onchange=e=>send('V'+e.target.value);
$('flash').onchange=e=>fetch('/flash?on='+(e.target.checked?1:0));
$('auto').onclick=()=>send(auto?'A0':'A1');
$('photo').onclick=async()=>{
  busy=true;const b=$('photo');b.disabled=true;b.textContent='⏳ Enviando…';
  $('res').textContent='Tomando y enviando la foto (si el servidor dormía puede tardar ~1 min)…';
  try{const r=await(await fetch('/photo')).json();$('res').textContent=(r.ok?'✅ ':'❌ ')+r.msg}
  catch(e){$('res').textContent='❌ Sin respuesta del robot'}
  b.disabled=false;b.textContent='📷 Tomar foto';busy=false;
};
setInterval(async()=>{if(busy)return;try{
  const s=await(await fetch('/status')).json();
  $('dist').textContent=s.dist>=999?'—':s.dist+' cm';$('state').textContent=s.state;$('sent').textContent=s.sent;
  auto=s.auto;$('mode').textContent=auto?'AUTÓNOMO':'MANUAL';$('auto').classList.toggle('on',auto);
  $('auto').textContent=auto?'⏹ Detener':'🤖 Autónomo';$('res').textContent=s.last;$('net').textContent=s.net;
}catch(e){}},800);
</script></body></html>
)HTML";

// ===================== ENVÍO SIN COPIAR LA FOTO =====================
// Stream que entrega: cabecera multipart → bytes de la cámara → cierre.
// HTTPClient lo va leyendo por partes, así no se crea una segunda copia de la imagen.
class MultipartStream : public Stream {
  const uint8_t* parts[3]; size_t lens[3]; size_t idx = 0, pos = 0;
 public:
  MultipartStream(const String& h, const uint8_t* img, size_t imgLen, const String& t) {
    parts[0] = (const uint8_t*)h.c_str(); lens[0] = h.length();
    parts[1] = img;                       lens[1] = imgLen;
    parts[2] = (const uint8_t*)t.c_str(); lens[2] = t.length();
  }
  int available() override {
    size_t r = 0;
    for (size_t i = idx; i < 3; i++) r += lens[i] - (i == idx ? pos : 0);
    return (int)r;
  }
  int read() override {
    while (idx < 3 && pos >= lens[idx]) { idx++; pos = 0; }
    return idx < 3 ? parts[idx][pos++] : -1;
  }
  int peek() override {
    size_t i = idx, p = pos;
    while (i < 3 && p >= lens[i]) { i++; p = 0; }
    return i < 3 ? parts[i][p] : -1;
  }
  size_t readBytes(char* buf, size_t len) {
    size_t n = 0;
    while (n < len && idx < 3) {
      if (pos >= lens[idx]) { idx++; pos = 0; continue; }
      size_t c = min(len - n, lens[idx] - pos);
      memcpy(buf + n, parts[idx] + pos, c);
      n += c; pos += c;
    }
    return n;
  }
  size_t write(uint8_t) override { return 0; }
  void flush() override {}
};

bool takeAndSendPhoto(String& msg) {
  if (cfgKey.length() == 0) { msg = "Falta la clave del robot: entra a ⚙️ Configurar"; return false; }
  if (WiFi.status() != WL_CONNECTED) { msg = "Sin internet: configura el WiFi en ⚙️"; return false; }
  if (xSemaphoreTake(netLock, pdMS_TO_TICKS(3000)) != pdTRUE) { msg = "Ya se está enviando una foto"; return false; }

  // 1) Captura: se descarta el cuadro en espera y se toma uno nuevo
  if (useFlash) { digitalWrite(FLASH_LED, HIGH); delay(120); }
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) esp_camera_fb_return(fb);
  fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED, LOW);
  if (!fb) { msg = "Error de cámara"; xSemaphoreGive(netLock); return false; }

  // 2) Envío directo desde el buffer de la cámara
  const String B = "----FloraDetectBoundary7MA4YWxk";
  String head = "--" + B + "\r\nContent-Disposition: form-data; name=\"plot_name\"\r\n\r\n" + cfgPlot + "\r\n"
              + "--" + B + "\r\nContent-Disposition: form-data; name=\"image\"; filename=\"hoja.jpg\"\r\n"
              + "Content-Type: image/jpeg\r\n\r\n";
  String tail = "\r\n--" + B + "--\r\n";
  size_t kb = fb->len / 1024;
  size_t total = head.length() + fb->len + tail.length();

  bool ok = false;
  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setConnectTimeout(20000);
    http.setTimeout(60000);                         // Render puede tardar en despertar
    if (http.begin(client, String(SERVER_URL) + "/api/robot/analyses")) {
      http.addHeader("X-Robot-Key", cfgKey);
      http.addHeader("Content-Type", "multipart/form-data; boundary=" + B);
      MultipartStream body(head, fb->buf, fb->len, tail);
      int code = http.sendRequest("POST", &body, total);
      ok = (code == 200 || code == 202);
      if (ok) msg = "Foto enviada (" + String(kb) + " KB). El reporte llegará a tu web en unos segundos.";
      else if (code == 401) msg = "Clave del robot inválida: corrígela en ⚙️";
      else if (code == 429) msg = "Demasiadas fotos por minuto, espera un momento";
      else if (code < 0) msg = "Sin conexión con el servidor (" + http.errorToString(code) + ")";
      else msg = "Error " + String(code) + ": " + http.getString().substring(0, 100);
      http.end();
    } else msg = "No se pudo conectar al servidor";
  }                                                  // ← se destruye la conexión HTTPS

  // 3) Liberar: la foto deja de existir en memoria
  esp_camera_fb_return(fb);
  fb = NULL;

  if (ok) { photosSent++; serverStatus = "✅ conectado"; }
  lastResult = (ok ? "✅ " : "❌ ") + msg;
  Serial.printf("%s | RAM libre: %u KB · PSRAM libre: %u KB\n", lastResult.c_str(),
                ESP.getFreeHeap() / 1024, ESP.getFreePsram() / 1024);
  xSemaphoreGive(netLock);
  return ok;
}

// Avisa al servidor que el robot está encendido y en qué IP local está (para el botón "Abrir control")
void sendHeartbeat() {
  if (cfgKey.length() == 0 || WiFi.status() != WL_CONNECTED) return;
  if (xSemaphoreTake(netLock, 0) != pdTRUE) return;   // si se está enviando una foto, se salta
  {
    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    http.setConnectTimeout(10000); http.setTimeout(15000);
    if (http.begin(client, String(SERVER_URL) + "/api/robot/heartbeat")) {
      http.addHeader("X-Robot-Key", cfgKey);
      http.addHeader("Content-Type", "application/x-www-form-urlencoded");
      int code = http.POST("local_ip=" + WiFi.localIP().toString());
      serverStatus = code == 200 ? "✅ conectado" : code == 401 ? "❌ clave del robot inválida"
                   : code < 0 ? "⏳ despertando o sin internet" : "error " + String(code);
      http.end();
    }
  }
  xSemaphoreGive(netLock);
}


// ===================== PÁGINA DE CONFIGURACIÓN =====================
String htmlEscape(String s) { s.replace("&", "&amp;"); s.replace("<", "&lt;"); s.replace("\"", "&quot;"); return s; }

String setupPage(const String& notice) {
  int n = WiFi.scanNetworks();
  String opts;
  for (int i = 0; i < n && i < 20; i++) {
    String s = WiFi.SSID(i);
    if (s.length() == 0 || opts.indexOf(">" + htmlEscape(s) + "<") >= 0) continue;
    opts += "<option value=\"" + htmlEscape(s) + "\">" + htmlEscape(s) + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
  }
  WiFi.scanDelete();
  String st = WiFi.status() == WL_CONNECTED ? "✅ Conectado a <b>" + htmlEscape(WiFi.SSID()) + "</b> · IP " + WiFi.localIP().toString()
                                            : "⚠ Sin conexión a WiFi";
  String keyHint = cfgKey.length() ? "Guardada (" + cfgKey.substring(0, 10) + "…). Déjala vacía para conservarla." : "Pégala desde flora-detect.vercel.app → Robots";
  String h = R"(<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurar robot</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#f6f1e7;color:#10200a}
header{background:#305d20;color:#fff;padding:14px 16px;font-weight:700}main{max-width:440px;margin:auto;padding:14px}
.card{background:#fff;border-radius:16px;padding:16px;box-shadow:0 4px 16px #10200a14;margin-bottom:12px}
label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;color:#305d20;margin:12px 0 4px}
input,select{width:100%;box-sizing:border-box;padding:12px;border:1px solid #10200a33;border-radius:12px;font-size:16px}
button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:12px;background:#305d20;color:#fff;font-size:16px;font-weight:700}
.n{background:#e3efd9;border-radius:12px;padding:10px;font-size:14px}small{color:#10200a99}a{color:#305d20}</style></head><body>
<header>⚙️ Configurar FloraDetect Robot</header><main>)";
  if (notice.length()) h += "<div class='card n'>" + notice + "</div>";
  h += "<div class='card'><div class='n'>" + st + "<br>Servidor: " + htmlEscape(serverStatus) + "</div>";
  h += R"(<form method="POST" action="/save">
<label>Red WiFi</label><select name="ssid_sel" onchange="document.getElementById('s').value=this.value"><option value="">— elegir de la lista —</option>)";
  h += opts;
  h += R"(</select><input id="s" name="ssid" placeholder="o escribe el nombre" value=")" + htmlEscape(cfgSsid) + R"(">
<label>Clave del WiFi</label><input name="pass" type="password" placeholder="(vacío = conservar la actual)">
<label>Clave del robot</label><input name="key" placeholder="fd_..." autocapitalize="off" autocomplete="off"><small>)" + keyHint + R"(</small>
<label>Parcela / lote</label><input name="plot" value=")" + htmlEscape(cfgPlot) + R"(">
<button>💾 Guardar y reiniciar</button></form></div>
<div class="card"><small>Consejo para la feria: usa el <b>hotspot de tu teléfono</b> como WiFi del robot. Así funciona en cualquier lugar.</small>
<p><a href="/">← Volver al control</a></p></div></main></body></html>)";
  return h;
}

String urlDecode(const String& s) {
  String o; o.reserve(s.length());
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '+') o += ' ';
    else if (c == '%' && i + 2 < s.length()) { o += (char)strtol(s.substring(i + 1, i + 3).c_str(), NULL, 16); i += 2; }
    else o += c;
  }
  return o;
}

String formField(const char* body, const char* key) {
  char v[129] = {0};
  if (httpd_query_key_value(body, key, v, sizeof(v)) == ESP_OK) return urlDecode(String(v));
  return "";
}

static esp_err_t setupGetHandler(httpd_req_t* req) {
  String h = setupPage("");
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  return httpd_resp_send(req, h.c_str(), h.length());
}

static esp_err_t setupSaveHandler(httpd_req_t* req) {
  char body[512] = {0};
  int len = httpd_req_recv(req, body, min((int)req->content_len, (int)sizeof(body) - 1));
  if (len <= 0) return httpd_resp_send_500(req);
  String ssid = formField(body, "ssid"); ssid.trim();
  String pass = formField(body, "pass");
  String key = formField(body, "key"); key.trim();
  String plot = formField(body, "plot"); plot.trim();

  String err;
  if (ssid.length() == 0) err = "Escribe o elige una red WiFi.";
  else if (key.length() && !key.startsWith("fd_")) err = "La clave del robot debe empezar con fd_";
  if (err.length()) {
    String h = setupPage("❌ " + err);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, h.c_str(), h.length());
  }
  prefs.putString("ssid", ssid);
  if (pass.length()) prefs.putString("pass", pass);
  else if (ssid != cfgSsid) prefs.putString("pass", "");       // red nueva sin clave = red abierta
  if (key.length()) prefs.putString("key", key);
  prefs.putString("plot", plot.length() ? plot : "Lote 1");

  String h = "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
             "<body style='font-family:system-ui;background:#f6f1e7;padding:24px;text-align:center'>"
             "<h2>✅ Guardado</h2><p>El robot se reinicia y se conecta a <b>" + htmlEscape(ssid) + "</b>.</p>"
             "<p>Vuelve a la red de tu WiFi y abre <b>flora-detect.vercel.app → Robots → Abrir control</b>"
             "<br>o <b>http://florarobot.local</b></p><p><small>Si no se conecta, la red FloraRobot volverá a aparecer.</small></p></body>";
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  httpd_resp_send(req, h.c_str(), h.length());
  restartPending = true;                                         // se reinicia desde loop()
  return ESP_OK;
}

// Portal cautivo: cualquier dirección desconocida → configuración (o control si ya hay WiFi)
static esp_err_t notFoundHandler(httpd_req_t* req, httpd_err_code_t err) {
  httpd_resp_set_status(req, "302 Found");
  httpd_resp_set_hdr(req, "Location", WiFi.status() == WL_CONNECTED ? "/" : "http://192.168.4.1/setup");
  return httpd_resp_send(req, NULL, 0);
}

// ===================== HANDLERS HTTP =====================
static String queryParam(httpd_req_t* req, const char* key) {
  char q[64] = {0}, v[32] = {0};
  if (httpd_req_get_url_query_str(req, q, sizeof(q)) == ESP_OK && httpd_query_key_value(q, key, v, sizeof(v)) == ESP_OK)
    return String(v);
  return "";
}

static String jsonSafe(String s) { s.replace("\\", "/"); s.replace("\"", "'"); s.replace("\n", " "); return s; }

static esp_err_t indexHandler(httpd_req_t* req) {
  if (WiFi.status() != WL_CONNECTED && cfgSsid.length() == 0) {      // primer arranque → configuración
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/setup");
    return httpd_resp_send(req, NULL, 0);
  }
  httpd_resp_set_type(req, "text/html; charset=utf-8");
  return httpd_resp_send(req, PAGE, strlen_P(PAGE));
}

static esp_err_t cmdHandler(httpd_req_t* req) {
  String c = queryParam(req, "c");
  bool valid = c == "F" || c == "B" || c == "L" || c == "R" || c == "S" || c == "A1" || c == "A0"
               || (c.startsWith("V") && c.length() <= 4);
  if (valid) Link.println(c);
  return httpd_resp_sendstr(req, valid ? "ok" : "bad");
}

static esp_err_t flashHandler(httpd_req_t* req) {
  useFlash = queryParam(req, "on") == "1";
  return httpd_resp_sendstr(req, "ok");
}

static esp_err_t photoHandler(httpd_req_t* req) {
  String msg;
  bool ok = takeAndSendPhoto(msg);
  String json = String("{\"ok\":") + (ok ? "true" : "false") + ",\"msg\":\"" + jsonSafe(msg) + "\"}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_sendstr(req, json.c_str());
}

static esp_err_t statusHandler(httpd_req_t* req) {
  int c1 = telemetry.indexOf(','), c2 = telemetry.indexOf(',', c1 + 1);
  String dist = telemetry.substring(0, c1), au = telemetry.substring(c1 + 1, c2), st = telemetry.substring(c2 + 1);
  if (dist.length() == 0) dist = "999";
  String net = WiFi.status() == WL_CONNECTED ? "WiFi " + WiFi.SSID() + " · " + WiFi.localIP().toString() + " · servidor " + serverStatus
                                             : "Sin WiFi (solo control local) · configura en ⚙️";
  String json = "{\"dist\":" + dist + ",\"auto\":" + (au == "1" ? "true" : "false") + ",\"state\":\"" + jsonSafe(st) +
                "\",\"last\":\"" + jsonSafe(lastResult) + "\",\"sent\":" + String(photosSent) +
                ",\"net\":\"" + jsonSafe(net) + "\"}";
  httpd_resp_set_type(req, "application/json");
  return httpd_resp_sendstr(req, json.c_str());
}

void startServer() {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.server_port = 80;
  cfg.stack_size = 12288;                         // el envío HTTPS y el escaneo WiFi necesitan pila
  cfg.max_uri_handlers = 10;
  httpd_uri_t routes[] = {
    {"/", HTTP_GET, indexHandler, NULL}, {"/cmd", HTTP_GET, cmdHandler, NULL},
    {"/photo", HTTP_GET, photoHandler, NULL}, {"/status", HTTP_GET, statusHandler, NULL},
    {"/flash", HTTP_GET, flashHandler, NULL}, {"/setup", HTTP_GET, setupGetHandler, NULL},
    {"/save", HTTP_POST, setupSaveHandler, NULL}};
  if (httpd_start(&webServer, &cfg) == ESP_OK) {
    for (auto& r : routes) httpd_register_uri_handler(webServer, &r);
    httpd_register_err_handler(webServer, HTTPD_404_NOT_FOUND, notFoundHandler);
  }
}

// ===================== CÁMARA / WIFI =====================
bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM; c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_SVGA;          // 800x600 → ~40-70 KB, ideal para analizar la hoja
  c.jpeg_quality = 10;                    // buena calidad (solo se toma bajo orden)
  c.fb_count = 1;                         // UN solo buffer: lo mínimo posible de memoria
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;   // no captura continuamente
  if (esp_camera_init(&c) != ESP_OK) return false;
  sensor_t* s = esp_camera_sensor_get();
  s->set_whitebal(s, 1); s->set_awb_gain(s, 1); s->set_exposure_ctrl(s, 1); s->set_gain_ctrl(s, 1);
  return true;
}

void loadConfig() {
  prefs.begin("flora", false);
  cfgSsid = prefs.getString("ssid", "");
  cfgPass = prefs.getString("pass", "");
  cfgKey  = prefs.getString("key", "");
  cfgPlot = prefs.getString("plot", "Lote 1");
}

void startNetwork() {
  WiFi.mode(WIFI_AP_STA);                        // red propia SIEMPRE + WiFi configurado
  WiFi.setSleep(false);
  WiFi.softAP(AP_SSID, AP_PASS);
  dns.start(53, "*", WiFi.softAPIP());           // portal cautivo
  Serial.printf("Red propia '%s' (clave %s) → http://%s\n", AP_SSID, AP_PASS, WiFi.softAPIP().toString().c_str());

  if (cfgSsid.length() == 0) { Serial.println("⚙ Sin WiFi configurado: conéctate a FloraRobot desde el teléfono"); return; }
  WiFi.setAutoReconnect(true);
  WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
  Serial.print("Conectando a "); Serial.println(cfgSsid);
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? "\n✔ WiFi OK → http://" + WiFi.localIP().toString()
                                               : String("\n⚠ No se pudo conectar; se seguirá intentando en segundo plano"));
}

void onlineTasks() {
  if (WiFi.status() == WL_CONNECTED && !mdnsStarted) {
    mdnsStarted = MDNS.begin(MDNS_NAME);
    if (mdnsStarted) MDNS.addService("http", "tcp", 80);
    Serial.printf("✔ Conectado · http://%s · http://%s.local\n", WiFi.localIP().toString().c_str(), MDNS_NAME);
    sendHeartbeat();
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);  // evita reinicios por bajones al arrancar los motores
  Serial.begin(115200);
  Link.begin(115200, SERIAL_8N1, LINK_RX, LINK_TX);
  pinMode(FLASH_LED, OUTPUT); digitalWrite(FLASH_LED, LOW);
  netLock = xSemaphoreCreateMutex();

  if (!initCamera()) { Serial.println("✖ Error iniciando la cámara (¿PSRAM activada?)"); delay(3000); ESP.restart(); }
  loadConfig();
  startNetwork();
  startServer();
  onlineTasks();
  Serial.printf("Listo · RAM libre: %u KB · PSRAM libre: %u KB\n", ESP.getFreeHeap() / 1024, ESP.getFreePsram() / 1024);
}

void loop() {
  dns.processNextRequest();

  while (Link.available()) {                    // mensajes de la ESP32 de motores
    char ch = Link.read();
    if (ch != '\n') { if (lineBuf.length() < 40) lineBuf += ch; continue; }
    lineBuf.trim();
    if (lineBuf.startsWith("T:")) telemetry = lineBuf.substring(2);
    else if (lineBuf == "P") {                  // el modo autónomo pide foto
      String msg; takeAndSendPhoto(msg);
      Link.println("K");                        // avisa al robot que puede seguir
    }
    lineBuf = "";
  }

  static unsigned long lastBeat = 0, lastCheck = 0;
  if (millis() - lastCheck > 5000) {
    lastCheck = millis();
    if (WiFi.status() != WL_CONNECTED) mdnsStarted = false;
    onlineTasks();
  }
  if (millis() - lastBeat > 120000) { lastBeat = millis(); sendHeartbeat(); }   // cada 2 min

  if (restartPending) { delay(1500); ESP.restart(); }
  delay(5);
}
