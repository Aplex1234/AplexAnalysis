from __future__ import annotations

from typing import Any

M = 1_000_000.0


def _row(
    year: int,
    revenue: float,
    gross: float,
    operating: float,
    net: float,
    ocf: float,
    capex: float,
    cash: float,
    debt: float,
    equity: float,
    shares: float,
    repurchases: float,
) -> dict[str, Any]:
    values = {
        "revenue": revenue * M,
        "gross_profit": gross * M,
        "operating_income": operating * M,
        "net_income": net * M,
        "operating_cash_flow": ocf * M,
        "capex": capex * M,
        "free_cash_flow": (ocf - capex) * M,
        "cash": cash * M,
        "long_term_debt": debt * M,
        "equity": equity * M,
        "diluted_shares": shares * M,
        "shares_outstanding": shares * M,
        "share_repurchases": repurchases * M,
        "diluted_eps": net / shares,
    }
    provenance = {
        metric: {
            "provider": "Bundled SEC-derived fallback snapshot",
            "as_of": "2025-02-28",
            "note": "Used only when live SEC retrieval is unavailable",
        }
        for metric in values
    }
    return {
        "fiscal_year": year,
        "period_type": "FY",
        "period_end": None,
        "filed_at": None,
        "accession_number": None,
        "form": "10-K",
        "currency": "USD",
        "values": values,
        "provenance": provenance,
    }


FALLBACK_COMPANIES: dict[str, dict[str, Any]] = {
    "AAPL": {
        "cik": "0000320193",
        "name": "Apple Inc.",
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "exchange": "NASDAQ",
        "description": (
            "Apple designs, manufactures and markets smartphones, personal computers, tablets, wearables and related "
            "services."
        ),
        "price": 243.85,
        "price_as_of": "2025-01-02",
        "periods": [
            _row(2020, 274515, 104956, 66288, 57411, 80674, 7309, 38016, 98667, 65339, 17528, 72358),
            _row(2021, 365817, 152836, 108949, 94680, 104038, 11085, 34940, 109106, 63090, 16865, 85971),
            _row(2022, 394328, 170782, 119437, 99803, 122151, 10708, 23646, 111109, 50672, 16216, 89402),
            _row(2023, 383285, 169148, 114301, 96995, 110543, 10959, 29965, 106548, 62146, 15813, 77550),
            _row(2024, 391035, 180683, 123216, 93736, 118254, 9447, 29943, 106629, 56950, 15242, 94949),
        ],
    },
    "NVDA": {
        "cik": "0001045810",
        "name": "NVIDIA Corporation",
        "sector": "Technology",
        "industry": "Semiconductors",
        "exchange": "NASDAQ",
        "description": (
            "NVIDIA develops accelerated computing platforms spanning data center, gaming, professional visualization "
            "and automotive markets."
        ),
        "price": 138.31,
        "price_as_of": "2025-01-02",
        "periods": [
            _row(2021, 16675, 10396, 4532, 4332, 5822, 1128, 11561, 6963, 16893, 24800, 0),
            _row(2022, 26914, 17475, 10041, 9752, 9108, 976, 21208, 10946, 26612, 25060, 0),
            _row(2023, 26974, 15356, 4224, 4368, 5641, 1833, 13296, 10956, 22101, 24700, 10039),
            _row(2024, 60922, 44301, 32972, 29760, 28090, 1069, 25984, 11056, 42978, 24670, 9533),
            _row(2025, 130497, 97858, 81453, 72880, 64089, 3236, 43210, 8463, 79327, 24490, 3327),
        ],
    },
    "COST": {
        "cik": "0000909832",
        "name": "Costco Wholesale Corporation",
        "sector": "Consumer Defensive",
        "industry": "Discount Stores",
        "exchange": "NASDAQ",
        "description": (
            "Costco operates membership warehouses and e-commerce sites offering limited-selection merchandise at low "
            "prices."
        ),
        "price": 916.00,
        "price_as_of": "2025-01-02",
        "periods": [
            _row(2020, 166761, 21514, 5435, 4002, 8861, 2810, 12277, 7529, 18284, 443, 196),
            _row(2021, 195929, 25745, 6708, 5007, 8958, 3588, 12175, 7571, 17767, 444, 496),
            _row(2022, 226954, 29084, 7793, 5844, 7386, 3891, 10203, 7494, 20642, 444, 439),
            _row(2023, 242290, 29515, 8114, 6292, 11869, 4323, 13700, 6593, 25058, 444, 676),
            _row(2024, 254453, 32242, 9285, 7367, 11286, 4710, 9906, 5756, 28742, 444, 700),
        ],
    },
}


PEER_SNAPSHOTS: dict[str, list[dict[str, Any]]] = {
    "AAPL": [
        {
            "ticker": "MSFT",
            "revenue_growth": 0.16,
            "ebitda_margin": 0.53,
            "fcf_margin": 0.34,
            "roic": 0.27,
            "pe": 35.0,
            "ev_revenue": 12.0,
            "ev_ebitda": 23.0,
            "price_fcf": 37.0,
        },
        {
            "ticker": "GOOGL",
            "revenue_growth": 0.14,
            "ebitda_margin": 0.36,
            "fcf_margin": 0.25,
            "roic": 0.24,
            "pe": 24.0,
            "ev_revenue": 6.5,
            "ev_ebitda": 18.0,
            "price_fcf": 26.0,
        },
        {
            "ticker": "DELL",
            "revenue_growth": 0.09,
            "ebitda_margin": 0.10,
            "fcf_margin": 0.05,
            "roic": 0.31,
            "pe": 20.0,
            "ev_revenue": 1.0,
            "ev_ebitda": 10.0,
            "price_fcf": 22.0,
        },
    ],
    "NVDA": [
        {
            "ticker": "AMD",
            "revenue_growth": 0.24,
            "ebitda_margin": 0.25,
            "fcf_margin": 0.14,
            "roic": 0.08,
            "pe": 47.0,
            "ev_revenue": 10.0,
            "ev_ebitda": 39.0,
            "price_fcf": 58.0,
        },
        {
            "ticker": "AVGO",
            "revenue_growth": 0.44,
            "ebitda_margin": 0.59,
            "fcf_margin": 0.41,
            "roic": 0.18,
            "pe": 36.0,
            "ev_revenue": 19.0,
            "ev_ebitda": 31.0,
            "price_fcf": 39.0,
        },
        {
            "ticker": "QCOM",
            "revenue_growth": 0.11,
            "ebitda_margin": 0.35,
            "fcf_margin": 0.29,
            "roic": 0.22,
            "pe": 18.0,
            "ev_revenue": 5.0,
            "ev_ebitda": 14.0,
            "price_fcf": 20.0,
        },
    ],
    "COST": [
        {
            "ticker": "WMT",
            "revenue_growth": 0.06,
            "ebitda_margin": 0.07,
            "fcf_margin": 0.02,
            "roic": 0.14,
            "pe": 35.0,
            "ev_revenue": 1.2,
            "ev_ebitda": 17.0,
            "price_fcf": 41.0,
        },
        {
            "ticker": "TGT",
            "revenue_growth": -0.01,
            "ebitda_margin": 0.08,
            "fcf_margin": 0.04,
            "roic": 0.17,
            "pe": 14.0,
            "ev_revenue": 0.8,
            "ev_ebitda": 9.0,
            "price_fcf": 15.0,
        },
        {
            "ticker": "KR",
            "revenue_growth": 0.01,
            "ebitda_margin": 0.05,
            "fcf_margin": 0.02,
            "roic": 0.13,
            "pe": 14.0,
            "ev_revenue": 0.4,
            "ev_ebitda": 7.0,
            "price_fcf": 13.0,
        },
    ],
}
