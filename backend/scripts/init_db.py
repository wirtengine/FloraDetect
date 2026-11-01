"""Ejecuta supabase/schema.sql en tu base de datos usando DATABASE_URL del .env.
Uso (desde backend/):  pip install psycopg[binary] python-dotenv && python scripts/init_db.py"""
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
sql = (Path(__file__).resolve().parents[2] / "supabase" / "schema.sql").read_text(encoding="utf-8")
with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as conn:
    conn.execute(sql)
print("✔ Esquema creado: tablas, RLS, bucket leaf-images y Realtime")
