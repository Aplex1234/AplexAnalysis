from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..providers.sec import SecProvider, SecProviderError
from ..sample_data import FALLBACK_COMPANIES
from ..schemas import ApiEnvelope, ResearchQuestion, SearchResult, ValuationRequest
from ..services.analysis import build_analysis

router = APIRouter(prefix="/api/v1")
DatabaseSession = Annotated[Session, Depends(get_db)]


@router.get("/search", response_model=list[SearchResult])
def search_companies(
    q: str = Query(min_length=1, max_length=80),
    limit: int = Query(default=8, ge=1, le=20),
) -> list[dict]:
    provider = SecProvider()
    try:
        return provider.search(q, limit=limit)
    except SecProviderError:
        needle = q.upper().strip()
        return [
            {
                "issuer_id": f"sec-cik:{company['cik']}",
                "security_id": f"sec-cik:{company['cik']}:equity:{ticker.lower()}",
                "listing_id": f"listing:xnas:{ticker.lower()}",
                "ticker": ticker,
                "name": company["name"],
                "cik": company["cik"],
                "exchange": "NASDAQ",
                "mic": "XNAS",
                "security_type": "Equity",
                "coverage": "Bundled fallback",
            }
            for ticker, company in FALLBACK_COMPANIES.items()
            if ticker.startswith(needle) or needle in company["name"].upper()
        ][:limit]
    finally:
        provider.close()


@router.get("/companies/{ticker}/analysis", response_model=ApiEnvelope)
def company_analysis(
    ticker: str,
    db: DatabaseSession,
    refresh: bool = False,
) -> ApiEnvelope:
    try:
        data = build_analysis(db, ticker, refresh=refresh)
        return ApiEnvelope(data=data, meta={"ticker": ticker.upper(), "refresh": refresh})
    except (SecProviderError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/companies/{ticker}/valuation", response_model=ApiEnvelope)
def custom_valuation(
    ticker: str,
    request: ValuationRequest,
    db: DatabaseSession,
) -> ApiEnvelope:
    try:
        data = build_analysis(db, ticker, assumptions=request.assumptions)
        return ApiEnvelope(data=data, meta={"ticker": ticker.upper(), "custom_assumptions": True})
    except (SecProviderError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/methodology")
def methodology() -> dict:
    return {
        "version": "0.1.0",
        "score_weights": {
            "valuation": 0.30,
            "quality": 0.20,
            "growth": 0.15,
            "financial_strength": 0.10,
            "capital_allocation": 0.10,
            "earnings_quality": 0.05,
            "momentum": 0.05,
            "risk": 0.05,
        },
        "fair_value_blend": {
            "dcf": 0.55,
            "peer_pe": 0.20,
            "growth_adjusted_pe": 0.15,
            "normalized_pe": 0.10,
        },
        "disclaimer": "Research software, not investment advice. Verify source filings before making decisions.",
    }


@router.post("/companies/{ticker}/research")
def research_chat(ticker: str, request: ResearchQuestion) -> dict:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={
            "message": (
                "Filing-grounded research chat is scaffolded but no LLM provider is configured in this milestone."
            ),
            "ticker": ticker.upper(),
            "question": request.question,
            "next_step": "Configure an OpenAI-compatible provider and add a filing chunk index.",
        },
    )
