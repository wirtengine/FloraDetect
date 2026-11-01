from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore",
                                      protected_namespaces=())

    supabase_url: str
    supabase_service_role_key: str          # SOLO en el backend, nunca en el frontend
    supabase_jwt_secret: str = ""           # Settings → API → JWT Secret (si está vacío se usa JWKS)
    storage_bucket: str = "leaf-images"

    model_dir: str = "model_files"
    model_file: str = "leaf_model.keras"

    cors_origins: str = "http://localhost:5173"
    max_upload_mb: float = 8.0
    max_image_side: int = 1280              # se reduce antes de procesar/guardar
    max_queue: int = 8                      # análisis simultáneos en espera; más → 503
    rate_limit_per_min: int = 30            # por usuario/robot

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
