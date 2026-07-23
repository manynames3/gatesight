"""Environment-backed API settings."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GATESIGHT_", case_sensitive=False)

    environment: str = "local"
    aws_region: str = "us-east-1"
    capture_bucket: str = "gatesight-local-captures"
    recognition_queue_url: str = ""
    presigned_expiration_seconds: int = Field(default=180, ge=60, le=600)
    max_frame_bytes: int = Field(default=8_000_000, ge=100_000, le=12_000_000)
    table_prefix: str = "gatesight-local"
    media_url_expiration_seconds: int = Field(default=120, ge=30, le=600)
    dlq_url: str = ""
    dashboard_url: str = "http://localhost:5173"


settings = Settings()
