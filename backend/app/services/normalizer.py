from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

TAG_CANDIDATES: dict[str, tuple[str, ...]] = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
    ),
    "gross_profit": ("GrossProfit",),
    "operating_income": ("OperatingIncomeLoss",),
    "net_income": ("NetIncomeLoss", "ProfitLoss"),
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities",),
    "capex": (
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsForAdditionsToPropertyPlantAndEquipment",
    ),
    "cash": (
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ),
    "assets": ("Assets",),
    "liabilities": ("Liabilities",),
    "equity": ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "long_term_debt": (
        "LongTermDebtAndFinanceLeaseObligationsCurrent",
        "LongTermDebtCurrent",
        "LongTermDebtNoncurrent",
        "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
    ),
    "diluted_shares": ("WeightedAverageNumberOfDilutedSharesOutstanding",),
    "shares_outstanding": ("CommonStocksIncludingAdditionalPaidInCapital", "EntityCommonStockSharesOutstanding"),
    "share_repurchases": ("PaymentsForRepurchaseOfCommonStock",),
    "dividends": ("PaymentsOfDividends", "PaymentsOfDividendsCommonStock"),
}


def _annual_points(fact: dict[str, Any], unit: str) -> list[dict[str, Any]]:
    points = fact.get("units", {}).get(unit, [])
    filtered = [
        point for point in points if point.get("form") == "10-K" and point.get("fy") and point.get("fp") == "FY"
    ]
    by_year: dict[int, dict[str, Any]] = {}
    for point in filtered:
        year = int(point["fy"])
        existing = by_year.get(year)
        if existing is None or point.get("filed", "") > existing.get("filed", ""):
            by_year[year] = point
    return list(by_year.values())


def _select_tag(
    us_gaap: dict[str, Any], candidates: tuple[str, ...], unit: str
) -> tuple[str | None, list[dict[str, Any]]]:
    for tag in candidates:
        if tag not in us_gaap:
            continue
        points = _annual_points(us_gaap[tag], unit)
        if points:
            return tag, points
    return None, []


def normalize_company_facts(payload: dict[str, Any], years: int = 6) -> list[dict[str, Any]]:
    us_gaap = payload.get("facts", {}).get("us-gaap", {})
    per_year: dict[int, dict[str, Any]] = defaultdict(lambda: {"values": {}, "provenance": {}})

    for metric, candidates in TAG_CANDIDATES.items():
        unit = "shares" if "shares" in metric else "USD"
        tag, points = _select_tag(us_gaap, candidates, unit)
        if tag is None:
            continue
        for point in points:
            year = int(point["fy"])
            value = float(point["val"])
            if metric == "long_term_debt":
                per_year[year]["values"][metric] = per_year[year]["values"].get(metric, 0.0) + value
            else:
                per_year[year]["values"][metric] = value
            per_year[year]["provenance"][metric] = {
                "provider": "SEC EDGAR Company Facts",
                "taxonomy": f"us-gaap:{tag}",
                "accession_number": point.get("accn"),
                "filed": point.get("filed"),
                "source_url": (
                    f"https://www.sec.gov/Archives/edgar/data/{int(payload['cik'])}/"
                    f"{point.get('accn', '').replace('-', '')}"
                ),
            }
            per_year[year]["period_end"] = point.get("end")
            per_year[year]["filed_at"] = point.get("filed")
            per_year[year]["accession_number"] = point.get("accn")

    rows = []
    for fiscal_year in sorted(per_year, reverse=True)[:years]:
        row = per_year[fiscal_year]
        values = row["values"]
        if values.get("operating_cash_flow") is not None and values.get("capex") is not None:
            values["free_cash_flow"] = values["operating_cash_flow"] - abs(values["capex"])
            row["provenance"]["free_cash_flow"] = {"formula": "operating_cash_flow - abs(capex)"}
        if values.get("net_income") is not None and values.get("diluted_shares"):
            values["diluted_eps"] = values["net_income"] / values["diluted_shares"]
            row["provenance"]["diluted_eps"] = {"formula": "net_income / diluted_shares"}
        rows.append(
            {
                "fiscal_year": fiscal_year,
                "period_type": "FY",
                "period_end": date.fromisoformat(row["period_end"]) if row.get("period_end") else None,
                "filed_at": date.fromisoformat(row["filed_at"]) if row.get("filed_at") else None,
                "accession_number": row.get("accession_number"),
                "form": "10-K",
                "currency": "USD",
                "values": values,
                "provenance": row["provenance"],
            }
        )
    return sorted(rows, key=lambda row: row["fiscal_year"])
