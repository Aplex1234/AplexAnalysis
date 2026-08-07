from __future__ import annotations

import statistics
from typing import Any

from ..schemas import DcfAssumptions
from .metrics import safe_div


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _dcf_value(
    periods: list[dict[str, Any]], growth: float, margin: float, wacc: float, terminal_growth: float, years: int
) -> float:
    latest = periods[-1]["values"]
    revenue = latest["revenue"]
    present_value = 0.0
    projected_fcf = 0.0
    for year in range(1, years + 1):
        revenue *= 1 + growth
        projected_fcf = revenue * margin
        present_value += projected_fcf / ((1 + wacc) ** year)
    terminal = projected_fcf * (1 + terminal_growth) / (wacc - terminal_growth)
    enterprise_value = present_value + terminal / ((1 + wacc) ** years)
    net_debt = (latest.get("long_term_debt") or 0) - (latest.get("cash") or 0)
    equity_value = enterprise_value - net_debt
    shares = latest.get("shares_outstanding") or latest.get("diluted_shares")
    return max(equity_value / shares, 0.0) if shares else 0.0


def reverse_dcf(
    periods: list[dict[str, Any]], current_price: float, margin: float, wacc: float, terminal_growth: float, years: int
) -> float:
    low, high = -0.20, 0.60
    for _ in range(80):
        midpoint = (low + high) / 2
        value = _dcf_value(periods, midpoint, margin, wacc, terminal_growth, years)
        if value < current_price:
            low = midpoint
        else:
            high = midpoint
    return (low + high) / 2


def calculate_valuation(
    periods: list[dict[str, Any]],
    metrics: dict[str, Any],
    current_price: float,
    assumptions: DcfAssumptions,
    peers: list[dict[str, Any]],
) -> dict[str, Any]:
    latest = periods[-1]["values"]
    observed_growth = metrics.get("revenue_cagr") or 0.05
    base_growth = (
        assumptions.revenue_growth if assumptions.revenue_growth is not None else clamp(observed_growth, 0.02, 0.25)
    )
    observed_margin = metrics.get("fcf_margin") or 0.08
    base_margin = assumptions.fcf_margin if assumptions.fcf_margin is not None else clamp(observed_margin, 0.02, 0.45)

    cases = {
        "bear": {
            "growth": clamp(base_growth - 0.04, -0.10, 0.40),
            "margin": clamp(base_margin * 0.86, 0.01, 0.55),
            "wacc": clamp(assumptions.wacc + 0.015, 0.05, 0.20),
            "terminal_growth": max(assumptions.terminal_growth - 0.005, 0.0),
        },
        "base": {
            "growth": base_growth,
            "margin": base_margin,
            "wacc": assumptions.wacc,
            "terminal_growth": assumptions.terminal_growth,
        },
        "bull": {
            "growth": clamp(base_growth + 0.04, -0.05, 0.45),
            "margin": clamp(base_margin * 1.10, 0.01, 0.58),
            "wacc": clamp(assumptions.wacc - 0.01, 0.05, 0.20),
            "terminal_growth": min(assumptions.terminal_growth + 0.005, 0.05),
        },
    }
    for case in cases.values():
        case["value"] = _dcf_value(
            periods, case["growth"], case["margin"], case["wacc"], case["terminal_growth"], assumptions.forecast_years
        )

    eps = safe_div(latest.get("net_income"), latest.get("diluted_shares")) or 0
    target_pe = clamp(18 + base_growth * 55 + (metrics.get("roic") or 0) * 18, 12, 42)
    growth_adjusted_value = eps * target_pe
    peer_pes = [peer["pe"] for peer in peers if peer.get("pe")]
    comparable_value = eps * statistics.median(peer_pes) if peer_pes else growth_adjusted_value
    normalized_multiple_value = eps * clamp(target_pe * 0.92, 12, 38)
    blended_fair_value = (
        cases["base"]["value"] * 0.55
        + comparable_value * 0.20
        + growth_adjusted_value * 0.15
        + normalized_multiple_value * 0.10
    )
    implied_growth = reverse_dcf(
        periods, current_price, base_margin, assumptions.wacc, assumptions.terminal_growth, assumptions.forecast_years
    )

    return {
        "current_price": current_price,
        "bear_value": cases["bear"]["value"],
        "base_value": blended_fair_value,
        "bull_value": max(cases["bull"]["value"], blended_fair_value),
        "upside_to_fair_value": safe_div(blended_fair_value, current_price) - 1,
        "methods": {
            "dcf": cases["base"]["value"],
            "comparable_companies": comparable_value,
            "growth_adjusted": growth_adjusted_value,
            "normalized_multiple": normalized_multiple_value,
        },
        "cases": cases,
        "reverse_dcf": {
            "implied_revenue_growth": implied_growth,
            "interpretation": (
                f"The market price implies approximately {implied_growth * 100:.1f}% annual revenue growth over the "
                "explicit forecast period."
            ),
        },
        "assumptions": {
            "forecast_years": assumptions.forecast_years,
            "revenue_growth": base_growth,
            "fcf_margin": base_margin,
            "wacc": assumptions.wacc,
            "terminal_growth": assumptions.terminal_growth,
        },
        "methodology": "55% DCF, 20% peer P/E, 15% growth-adjusted P/E, 10% normalized P/E",
    }
