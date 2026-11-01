# 🍃 FloraDetect 2.0 — Diagnóstico de hojas de tomate para el Robot Agrícola

El robot toma la foto → la envía al servidor → el servidor **aísla la hoja (ignora el fondo)**, la clasifica entre **10 clases** (sana + 9 enfermedades), calcula el **% de área afectada**, genera un **mapa de calor** de la zona enferma, guarda el **reporte** y te **notifica en tiempo real** en la web.

```
floradetect/
├── supabase/schema.sql      ← script de base de datos (ejecutar 1 vez en Supabase)
├── backend/                 ← API FastAPI + modelo (Python)
│   ├── app/ml/segmentation.py   aísla la hoja y quita el fondo
│   ├── app/ml/classifier.py     clasificación + Grad-CAM (mapa de calor)
│   ├── app/ml/diseases.py       enfermedades y recomendaciones en español
│   └── model_files/             modelos (.keras)
├── ml/                      ← preparar dataset y entrenar
├── frontend/                ← web React + Vite + Tailwind
└── robot/robot_client.py    ← script para el robot (Raspberry Pi)
```

**Tecnologías:** React 18 + Vite + Tailwind · FastAPI · TensorFlow/Keras (MobileNetV2) · OpenCV · Supabase (Auth, Postgres con RLS, Storage, Realtime).

**Roles:** `admin` (todo + gestionar usuarios), `agronomo` (ve todos los reportes para asesorar), `operador` (sus robots y reportes).

---

## 1. Supabase (base de datos)

1. Crea un proyecto en https://supabase.com.
2. **SQL Editor → New query** → pega todo `supabase/schema.sql` → **Run**. Crea tablas, roles, seguridad RLS, el bucket privado `leaf-images`, la función de estadísticas y activa Realtime.
3. **Authentication → URL Configuration**: pon `http://localhost:5173` en *Site URL*. (Para pruebas puedes desactivar *Confirm email* en Authentication → Providers → Email.)
4. Copia de **Project Settings → API**: `Project URL`, `anon key`, `service_role key` y (si aparece) el `JWT Secret`.
5. Regístrate en la web y luego vuélvete admin ejecutando en SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'tu-correo@ejemplo.com';
   ```

## 2. Entrenar el modelo (10 clases, con fondo eliminado)

El modelo original solo distinguía *sana / tizón tardío*. Se re-entrena con todas tus carpetas aplicando **la misma segmentación que usa el servidor**, para que el modelo aprenda de la hoja y no del fondo.

```bash
cd floradetect
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt

# 1) segmentar y dividir el dataset (usa tus carpetas train/ y valid/ si existe)
python ml/prepare_data.py --src "/home/wirtengine/Downloads/archive/Tomato Leaf Disease"

# 2) entrenar (CPU: ~1-2 h; con GPU: minutos)
python ml/train.py
```
Resultado en `backend/model_files/`: `leaf_model.keras`, `model_meta.json` y `training_report.txt` (exactitud y matriz de confusión — úsalo en tu informe).

> Mientras no entrenes, el servidor usa automáticamente el modelo viejo `plant_model_best.keras` (2 clases), así ya puedes probar todo.

## 3. Backend

```bash
cd backend
cp .env.example .env        # llena SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```
Prueba: http://localhost:8000/api/health y la documentación interactiva en http://localhost:8000/docs.

## 4. Frontend

```bash
cd frontend
cp .env.example .env        # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm install
npm run dev                 # http://localhost:5173
```
Producción: `npm run build` y sube `dist/` a Vercel/Netlify (define `VITE_API_URL` con la URL del backend y añádela a `CORS_ORIGINS` del backend).

## 5. Robot

1. En la web → **Robots → Registrar robot** → copia la clave `fd_…` (solo se muestra una vez).
2. En el robot:
   ```bash
   pip install requests opencv-python-headless
   export FLORADETECT_URL=http://IP-DEL-SERVIDOR:8000
   export FLORADETECT_KEY=fd_tu_clave
   python robot_client.py --file hoja.jpg --wait     # prueba
   python robot_client.py --interval 20 --plot "Lote 2"   # modo patrulla
   ```
   Descarta fotos borrosas, reduce la imagen antes de enviar, y si se cae el wifi guarda las fotos en cola y las reenvía después.

---

## Cómo funciona el análisis

1. **Segmentación de la hoja** (`segmentation.py`): índice de verdor ExG + HSV (verde **y** amarillo/marrón, para no borrar las lesiones), se queda con el objeto más grande, rellena huecos internos (las manchas quedan dentro de la hoja), refina bordes con GrabCut y recorta. El fondo se pone negro. Si no hay hoja (<3 % de la imagen) el reporte dice “No se detectó hoja”.
2. **Clasificación**: MobileNetV2 sobre la hoja recortada → probabilidad de cada clase.
3. **Mapa de calor**: Grad-CAM (dónde “miró” el modelo) combinado con el mapa de color de lesiones, **multiplicado por la máscara de la hoja**: el fondo nunca se marca. La zona más afectada se rodea en rojo.
4. **Severidad**: % de la hoja con tejido no verde → ninguna / leve (<10 %) / moderada (<30 %) / severa.
5. **Reporte + notificación**: se guardan original, hoja aislada, mapa de calor y miniatura (WebP) en Storage; se inserta una notificación que llega por Realtime a la web (toast + notificación del navegador).

## Optimización (para no cargar el servidor)

- La foto se reduce **en el teléfono/robot** antes de enviarse (de ~5 MB a ~300 KB).
- El modelo se carga **una vez** y se precalienta al iniciar; TensorFlow limitado a `TF_THREADS` hilos.
- Cola acotada (`MAX_QUEUE`) y límite por minuto (`RATE_LIMIT_PER_MIN`) → responde 503/429 en vez de colapsar.
- El robot recibe `202` al instante; el análisis corre en segundo plano.
- Las **lecturas** (historial, panel, notificaciones) van directo del navegador a Supabase con RLS: el backend solo hace el trabajo pesado (IA).
- Estadísticas del panel en **una sola consulta SQL** (`dashboard_stats`).
- Imágenes en WebP, miniaturas de 320 px para listas, URLs firmadas en caché, páginas con carga diferida (lazy) y paginación.
- Notificaciones por WebSocket (Realtime), sin *polling*.
