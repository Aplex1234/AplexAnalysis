from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AnalysisSnapshot, Company, Filing, FinancialPeriod
from ..providers.market import MarketDataError, NasdaqMarketProvider
from ..providers.sec import SecProvider, SecProviderError
from ..sample_data import FALLBACK_COMPANIES, PEER_SNAPSHOTS
from ..schemas import DcfAssumptions
from .metrics import calculate_metrics
from .normalizer import normalize_company_facts
from .scoring import calculate_buy_target, calculate_scores
from .valuation import calculate_valuation


def _serialize_period(period: FinancialPeriod | dict[str, Any]) -> dict[str, Any]:
    if isinstance(period, dict):
        serialized = dict(period)
        for key in ("period_end", "filed_at"):
            value = serialized.get(key)
            if value is not None and hasattr(value, "isoformat"):
                serialized[key] = value.isoformat()
        return serialized
    return {
        "fiscal_year": period.fiscal_year,
        "period_type": period.period_type,
        "period_end": period.period_end.isoformat() if period.period_end else None,
        "filed_at": period.filed_at.isoformat() if period.filed_at else None,
        "accession_number": period.accession_number,
        "form": period.form,
        "currency": period.currency,
        "values": period.values,
        "provenance": period.provenance,
    }


def _upsert_company(db: Session, identity: dict[str, Any], submissions: dict[str, Any] | None = None) -> Company:
    company = db.scalar(select(Company).where(Company.ticker == identity["ticker"]))
    if company is None:
        company = Company(ticker=identity["ticker"], cik=identity.get("cik"), name=identity["name"])
        db.add(company)
    if submissions:
        company.name = submissions.get("name") or company.name
        company.exchange = (submissions.get("exchanges") or [None])[0]
        company.fiscal_year_end = submissions.get("fiscalYearEnd")
    fallback = FALLBACK_COMPANIES.get(identity["ticker"], {})
    company.sector = fallback.get("sector")
    company.industry = fallback.get("industry")
    company.description = fallback.get("description")
    company.exchange = company.exchange or fallback.get("exchange")
    db.flush()
    return company


def _persist_periods(db: Session, company: Company, periods: list[dict[str, Any]]) -> None:
    for row in periods:
        existing = db.scalar(
            select(FinancialPeriod).where(
                FinancialPeriod.company_id == company.id,
                FinancialPeriod.fiscal_year == row["fiscal_year"],
                FinancialPeriod.period_type == row["period_type"],
            )
        )
        if existing is None:
            existing = FinancialPeriod(
                company_id=company.id, fiscal_year=row["fiscal_year"], period_type=row["period_type"]
            )
            db.add(existing)
        for key in ("period_end", "filed_at", "accession_number", "form", "currency", "values", "provenance"):
            setattr(existing, key, row[key])


def _persist_filings(db: Session, company: Company, rows: list[dict[str, Any]]) -> None:
    for row in rows:
        existing = db.scalar(
            select(Filing).where(Filing.company_id == company.id, Filing.accession_number == row["accession_number"])
        )
        if existing is None:
            db.add(Filing(company_id=company.id, **row))


def _load_or_fetch(
    db: Session, ticker: str, refresh: bool
) -> tuple[Company, list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    normalized = ticker.upper().strip()
    warnings: list[str] = []
    existing = db.scalar(select(Company).where(Company.ticker == normalized))
    stored_periods = []
    if existing:
        stored_periods = db.scalars(
            select(FinancialPeriod)
            .where(FinancialPeriod.company_id == existing.id)
            .order_by(FinancialPeriod.fiscal_year)
        ).all()
    if stored_periods and not refresh:
        filings = db.scalars(
            select(Filing).where(Filing.company_id == existing.id).order_by(Filing.filing_date.desc()).limit(20)
        ).all()
        return (
            existing,
            [_serialize_period(item) for item in stored_periods],
            [
                {
                    "form": item.form,
                    "filing_date": item.filing_date,
                    "report_date": item.report_date,
                    "accession_number": item.accession_number,
                    "source_url": item.source_url,
                }
                for item in filings
            ],
            warnings,
        )

    provider = SecProvider()
    try:
        identity = provider.resolve_ticker(normalized)
        submissions = provider.submissions(identity["cik"])
        facts = provider.company_facts(identity["cik"])
        periods = normalize_company_facts(facts)
        if len(periods) < 3:
            raise SecProviderError("SEC facts did not contain enough normalized annual periods")
        filing_rows = provider.recent_filings(submissions)
        company = _upsert_company(db, identity, submissions)
        _persist_periods(db, company, periods)
        _persist_filings(db, company, filing_rows)
        db.commit()
        return company, periods, filing_rows, warnings
    except SecProviderError as exc:
        fallback = FALLBACK_COMPANIES.get(normalized)
        if fallback is None:
            raise
        warnings.append(f"Live SEC retrieval unavailable. Using bundled SEC-derived snapshot: {exc}")
        identity = {"ticker": normalized, "name": fallback["name"], "cik": fallback["cik"]}
        company = _upsert_company(db, identity)
        _persist_periods(db, company, fallback["periods"])
        db.commit()
        return company, fallback["periods"], [], warnings
    finally:
        provider.close()


def build_analysis(
    db: Session, ticker: str, assumptions: DcfAssumptions | None = None, refresh: bool = False
) -> dict[str, Any]:
    company, periods, filings, warnings = _load_or_fetch(db, ticker, refresh)
    fallback = FALLBACK_COMPANIES.get(company.ticker, {})
    try:
        quote = NasdaqMarketProvider().quote(company.ticker)
    except MarketDataError as exc:
        if not fallback.get("price"):
            raise
        quote = {
            "price": fallback["price"],
            "as_of": fallback["price_as_of"],
            "currency": "USD",
            "provider": "Bundled historical fallback quote",
            "source_url": None,
            "is_delayed": True,
        }
        warnings.append(f"Live delayed quote unavailable. Using dated fallback quote: {exc}")

    metrics = calculate_metrics(periods, quote["price"])
    peers = PEER_SNAPSHOTS.get(company.ticker, [])
    valuation = calculate_valuation(periods, metrics, quote["price"], assumptions or DcfAssumptions(), peers)
    score = calculate_scores(metrics, valuation)
    buy_target = calculate_buy_target(metrics, valuation, score)
    latest = periods[-1]["values"]
    uses_fallback_financials = any(
        any(
            source.get("provider") == "Bundled SEC-derived fallback snapshot"
            for source in period["provenance"].values()
        )
        for period in periods
    )
    source_mode = "fallback-snapshot" if uses_fallback_financials else "live-sec"
    public_periods = [_serialize_period(period) for period in periods]
    public_filings = [
        {
            **row,
            "filing_date": row["filing_date"].isoformat()
            if hasattr(row.get("filing_date"), "isoformat")
            else row.get("filing_date"),
            "report_date": row["report_date"].isoformat()
            if hasattr(row.get("report_date"), "isoformat")
            else row.get("report_date"),
        }
        for row in filings
    ]
    payload = {
        "company": {
            "ticker": company.ticker,
            "name": company.name,
            "cik": company.cik,
            "sector": company.sector,
            "industry": company.industry,
            "exchange": company.exchange,
            "description": company.description,
        },
        "quote": quote,
        "headline": {
            "score": score["overall"],
            "rating": score["rating"],
            "current_price": quote["price"],
            "fair_value": valuation["base_value"],
            "buy_target": buy_target["buy_target"],
            "bear_value": valuation["bear_value"],
            "base_value": valuation["base_value"],
            "bull_value": valuation["bull_value"],
            "upside": valuation["upside_to_fair_value"],
        },
        "financials": public_periods,
        "latest": latest,
        "metrics": metrics,
        "valuation": valuation,
        "buy_target": buy_target,
        "score": score,
        "comps": peers,
        "filings": public_filings,
        "risks": _derive_risks(metrics, valuation),
        "provenance": {
            "financials": source_mode,
            "quote": quote["provider"],
            "peer_snapshot_as_of": "2025-02-28",
            "methodology_version": "0.1.0",
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "warnings": warnings,
        },
    }
    snapshot = AnalysisSnapshot(company_id=company.id, current_price=quote["price"], payload=payload)
    db.add(snapshot)
    db.commit()
    return payload


def _derive_risks(metrics: dict[str, Any], valuation: dict[str, Any]) -> list[dict[str, str]]:
    risks = []
    implied_growth = valuation["reverse_dcf"]["implied_revenue_growth"]
    if implied_growth > 0.15:
        risks.append(
            {
                "severity": "high",
                "title": "Demanding expectations",
                "detail": "The current price embeds revenue growth above 15% in the reverse DCF.",
            }
        )
    if (metrics.get("net_debt_to_fcf") or 0) > 2:
        risks.append(
            {
                "severity": "medium",
                "title": "Leverage",
                "detail": "Net debt exceeds two years of current free cash flow.",
            }
        )
    if (metrics.get("operating_margin_volatility") or 0) > 0.04:
        risks.append(
            {
                "severity": "medium",
                "title": "Margin variability",
                "detail": "Operating margins have varied materially across the available history.",
            }
        )
    if (metrics.get("share_change") or 0) > 0.01:
        risks.append(
            {
                "severity": "medium",
                "title": "Share dilution",
                "detail": "Diluted shares increased more than 1% in the latest fiscal year.",
            }
        )
    if not risks:
        risks.append(
            {
                "severity": "low",
                "title": "Model uncertainty",
                "detail": "The largest quantified risk is sensitivity to discount rate and terminal assumptions.",
            }
        )
    return risks
