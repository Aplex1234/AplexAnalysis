from typing import Any

from pydantic import BaseModel, Field, field_validator


class DcfAssumptions(BaseModel):
    forecast_years: int = Field(default=5, ge=3, le=10)
    revenue_growth: float | None = Field(default=None, ge=-0.25, le=0.50)
    fcf_margin: float | None = Field(default=None, ge=-0.25, le=0.60)
    wacc: float = Field(default=0.09, ge=0.05, le=0.20)
    terminal_growth: float = Field(default=0.025, ge=0.0, le=0.06)


class ValuationRequest(BaseModel):
    assumptions: DcfAssumptions = Field(default_factory=DcfAssumptions)


class SearchResult(BaseModel):
    ticker: str
    name: str
    cik: str | None = None


class ResearchQuestion(BaseModel):
    question: str = Field(min_length=3, max_length=1000)

    @field_validator("question")
    @classmethod
    def strip_question(cls, value: str) -> str:
        return value.strip()


class ApiEnvelope(BaseModel):
    data: dict[str, Any]
    meta: dict[str, Any] = Field(default_factory=dict)
