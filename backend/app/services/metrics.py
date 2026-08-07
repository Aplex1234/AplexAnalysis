from __future__ import annotations

import math
import statistics
from typing import Any


def safe_div(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def cagr(start: float | None, end: float | None, periods: int) -> float | None:
    if start is None or end is None or start <= 0 or end <= 0 or periods <= 0:
        return None
    return (end / start) ** (1 / periods) - 1


def _series(periods: list[dict[str, Any]], key: str) -> list[float]:
    return [float(period["values"][key]) for period in periods if period["values"].get(key) is not None]


def calculate_metrics(periods: list[dict[str, Any]], current_price: float | None) -> dict[str, Any]:
    ordered = sorted(periods, key=lambda period: period["fiscal_year"])
    latest = ordered[-1]["values"]
    previous = ordered[-2]["values"] if len(ordered) > 1 else {}
    span = max(len(ordered) - 1, 1)

    revenue = _series(ordered, "revenue")
    net_income = _series(ordered, "net_income")
    fcf = _series(ordered, "free_cash_flow")
    margins = [
        safe_div(period["values"].get("operating_income"), period["values"].get("revenue")) for period in ordered
    ]
    margins = [value for value in margins if value is not None]

    invested_capital = (latest.get("equity") or 0) + (latest.get("long_term_debt") or 0) - (latest.get("cash") or 0)
    nopat = (latest.get("operating_income") or 0) * 0.79
    shares = latest.get("shares_outstanding") or latest.get("diluted_shares")
    market_cap = current_price * shares if current_price is not None and shares else None
    net_debt = (latest.get("long_term_debt") or 0) - (latest.get("cash") or 0)
    eps = safe_div(latest.get("net_income"), latest.get("diluted_shares"))

    result = {
        "revenue_growth_yoy": safe_div(latest.get("revenue"), previous.get("revenue")),
        "eps_growth_yoy": safe_div(eps, safe_div(previous.get("net_income"), previous.get("diluted_shares"))),
        "fcf_growth_yoy": safe_div(latest.get("free_cash_flow"), previous.get("free_cash_flow")),
        "revenue_cagr": cagr(revenue[0], revenue[-1], span) if len(revenue) > 1 else None,
        "net_income_cagr": cagr(net_income[0], net_income[-1], span) if len(net_income) > 1 else None,
        "fcf_cagr": cagr(fcf[0], fcf[-1], span) if len(fcf) > 1 else None,
        "gross_margin": safe_div(latest.get("gross_profit"), latest.get("revenue")),
        "operating_margin": safe_div(latest.get("operating_income"), latest.get("revenue")),
        "fcf_margin": safe_div(latest.get("free_cash_flow"), latest.get("revenue")),
        "roic": safe_div(nopat, invested_capital),
        "roe": safe_div(latest.get("net_income"), latest.get("equity")),
        "net_debt": net_debt,
        "net_debt_to_fcf": safe_div(net_debt, latest.get("free_cash_flow")),
        "fcf_conversion": safe_div(latest.get("free_cash_flow"), latest.get("net_income")),
        "share_change": (safe_div(latest.get("diluted_shares"), previous.get("diluted_shares")) or 1) - 1,
        "buyback_yield": safe_div(latest.get("share_repurchases"), market_cap),
        "market_cap": market_cap,
        "pe": safe_div(current_price, eps),
        "price_to_fcf": safe_div(market_cap, latest.get("free_cash_flow")),
        "fcf_yield": safe_div(latest.get("free_cash_flow"), market_cap),
        "operating_margin_volatility": statistics.pstdev(margins) if len(margins) > 1 else 0.0,
        "earnings_positive_years": sum(1 for value in net_income if value > 0),
        "history_years": len(ordered),
    }
    for growth_key in ("revenue_growth_yoy", "eps_growth_yoy", "fcf_growth_yoy"):
        if result[growth_key] is not None:
            result[growth_key] -= 1
    return {key: value if value is None or math.isfinite(value) else None for key, value in result.items()}
