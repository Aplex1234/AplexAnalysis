from __future__ import annotations

from typing import Any

from .valuation import clamp

WEIGHTS = {
    "valuation": 0.30,
    "quality": 0.20,
    "growth": 0.15,
    "financial_strength": 0.10,
    "capital_allocation": 0.10,
    "earnings_quality": 0.05,
    "momentum": 0.05,
    "risk": 0.05,
}


def _scaled(value: float | None, poor: float, excellent: float, default: float = 50) -> float:
    if value is None:
        return default
    if excellent == poor:
        return default
    return clamp((value - poor) / (excellent - poor) * 100, 0, 100)


def calculate_scores(metrics: dict[str, Any], valuation: dict[str, Any]) -> dict[str, Any]:
    upside = valuation["upside_to_fair_value"]
    valuation_score = 0.65 * _scaled(upside, -0.35, 0.50) + 0.35 * _scaled(metrics.get("fcf_yield"), 0.015, 0.08)
    quality_score = (
        0.45 * _scaled(metrics.get("roic"), 0.05, 0.30)
        + 0.30 * _scaled(metrics.get("operating_margin"), 0.05, 0.35)
        + 0.25 * _scaled(metrics.get("fcf_conversion"), 0.55, 1.10)
    )
    growth_score = (
        0.45 * _scaled(metrics.get("revenue_cagr"), 0.00, 0.20)
        + 0.30 * _scaled(metrics.get("net_income_cagr"), -0.03, 0.25)
        + 0.25 * _scaled(metrics.get("fcf_cagr"), -0.03, 0.25)
    )
    debt_ratio = metrics.get("net_debt_to_fcf")
    debt_score = 90 if debt_ratio is not None and debt_ratio < 0 else _scaled(debt_ratio, 4.0, 0.0)
    financial_strength_score = 0.65 * debt_score + 0.35 * _scaled(metrics.get("fcf_conversion"), 0.5, 1.1)
    capital_allocation_score = 0.55 * _scaled(-(metrics.get("share_change") or 0), -0.03, 0.04) + 0.45 * _scaled(
        metrics.get("buyback_yield"), 0.0, 0.05
    )
    positive_ratio = (metrics.get("earnings_positive_years") or 0) / max(metrics.get("history_years") or 1, 1)
    earnings_quality_score = 0.55 * positive_ratio * 100 + 0.45 * _scaled(
        metrics.get("operating_margin_volatility"), 0.08, 0.0
    )
    momentum_score = 0.5 * _scaled(metrics.get("revenue_growth_yoy"), -0.10, 0.25) + 0.5 * _scaled(
        metrics.get("fcf_growth_yoy"), -0.25, 0.35
    )
    risk_score = (
        0.50 * _scaled(metrics.get("operating_margin_volatility"), 0.10, 0.0)
        + 0.35 * debt_score
        + 0.15 * positive_ratio * 100
    )

    categories = {
        "valuation": round(valuation_score),
        "quality": round(quality_score),
        "growth": round(growth_score),
        "financial_strength": round(financial_strength_score),
        "capital_allocation": round(capital_allocation_score),
        "earnings_quality": round(earnings_quality_score),
        "momentum": round(momentum_score),
        "risk": round(risk_score),
    }
    overall = round(sum(categories[key] * weight for key, weight in WEIGHTS.items()))
    rating = (
        "Highly Attractive"
        if overall >= 85
        else "Attractive"
        if overall >= 70
        else "Neutral"
        if overall >= 50
        else "Unattractive"
    )
    return {
        "overall": overall,
        "rating": rating,
        "categories": categories,
        "weights": WEIGHTS,
        "formula": "Weighted arithmetic mean of eight transparent, metric-derived category scores",
    }


def calculate_buy_target(metrics: dict[str, Any], valuation: dict[str, Any], score: dict[str, Any]) -> dict[str, Any]:
    margin_volatility = metrics.get("operating_margin_volatility") or 0
    debt_ratio = max(metrics.get("net_debt_to_fcf") or 0, 0)
    growth_uncertainty = abs((metrics.get("revenue_growth_yoy") or 0) - (metrics.get("revenue_cagr") or 0))
    risk_score = score["categories"]["risk"]

    components = {
        "base": 0.10,
        "earnings_and_margin_volatility": clamp(margin_volatility * 0.8, 0, 0.08),
        "balance_sheet_risk": clamp(debt_ratio * 0.015, 0, 0.07),
        "growth_uncertainty": clamp(growth_uncertainty * 0.20, 0, 0.05),
        "low_risk_credit": -clamp((risk_score - 70) / 1000, 0, 0.03),
    }
    margin_of_safety = clamp(sum(components.values()), 0.08, 0.35)
    buy_target = valuation["base_value"] * (1 - margin_of_safety)
    return {
        "fair_value": valuation["base_value"],
        "margin_of_safety": margin_of_safety,
        "buy_target": buy_target,
        "current_price_gap": buy_target / valuation["current_price"] - 1,
        "components": components,
        "methodology": "Dynamic 8% to 35% margin of safety based on stability, debt, uncertainty, and risk score",
    }
