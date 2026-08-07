from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AplexAnalysis"
    environment: str = "development"
    database_url: str = "sqlite:///./aplexanalysis.db"
    frontend_origin: str = "http://localhost:3000"
    sec_user_agent: str = "AplexAnalysis/0.1 research@example.com"
    request_timeout_seconds: float = 15.0
    openai_api_key: str | None = None
    openai_base_url: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
