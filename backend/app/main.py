from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .config import get_settings
from .database import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


settings = get_settings()
allowed_origins = [settings.frontend_origin]
if settings.frontend_origin.startswith("http://localhost"):
    allowed_origins.append(settings.frontend_origin.replace("localhost", "127.0.0.1", 1))
elif settings.frontend_origin.startswith("http://127.0.0.1"):
    allowed_origins.append(settings.frontend_origin.replace("127.0.0.1", "localhost", 1))
app = FastAPI(
    title=settings.app_name,
    description="Transparent equity research, valuation and scoring API",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}
