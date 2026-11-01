import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from loguru import logger

from .config import settings
from .routes import router
from .supabase import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Carga y precalienta el modelo en segundo plano: el servidor responde de inmediato
    from .ml.classifier import get_classifier
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, get_classifier)
    logger.info("FloraDetect API iniciada")
    yield
    await db.close()


app = FastAPI(title="FloraDetect API", version="2.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
