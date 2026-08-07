from __future__ import annotations

import re
from datetime import date
from typing import Any

import httpx

from ..config import get_settings

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_TICKERS_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"


class SecProviderError(RuntimeError):
    pass


EXCHANGE_MIC = {
    "NASDAQ": "XNAS",
    "NYSE": "XNYS",
    "NYSE AMERICAN": "XASE",
    "NYSE ARCA": "ARCX",
    "CBOE": "BATS",
    "OTC": "OTCM",
}


def normalize_ticker(value: str) -> str:
    """Normalize common share-class separators to the SEC ticker format."""
    return re.sub(r"[./\s]+", "-", value.strip().upper())


def _identifier_token(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", value.upper()).strip("-").lower()


def security_identity(*, ticker: str, name: str, cik: str | int, exchange: str | None) -> dict[str, Any]:
    normalized_ticker = normalize_ticker(ticker)
    normalized_cik = str(cik).zfill(10)
    normalized_exchange = (exchange or "Unknown").strip() or "Unknown"
    mic = EXCHANGE_MIC.get(normalized_exchange.upper(), _identifier_token(normalized_exchange) or "unknown")
    ticker_token = _identifier_token(normalized_ticker)
    return {
        "issuer_id": f"sec-cik:{normalized_cik}",
        "security_id": f"sec-cik:{normalized_cik}:equity:{ticker_token}",
        "listing_id": f"listing:{mic.lower()}:{ticker_token}",
        "ticker": normalized_ticker,
        "name": name.strip(),
        "cik": normalized_cik,
        "exchange": normalized_exchange,
        "mic": mic,
        "security_type": "Equity",
        "coverage": "SEC filer",
    }


def parse_security_master(payload: dict[str, Any]) -> list[dict[str, Any]]:
    fields = payload.get("fields")
    rows = payload.get("data")
    if isinstance(fields, list) and isinstance(rows, list):
        index = {str(field): position for position, field in enumerate(fields)}
        required = {"cik", "name", "ticker", "exchange"}
        if required.issubset(index):
            return [
                security_identity(
                    cik=row[index["cik"]],
                    name=str(row[index["name"]]),
                    ticker=str(row[index["ticker"]]),
                    exchange=str(row[index["exchange"]] or "Unknown"),
                )
                for row in rows
                if isinstance(row, list) and len(row) >= len(fields)
            ]

    entries: list[dict[str, Any]] = []
    for item in payload.values():
        if not isinstance(item, dict) or not {"cik_str", "ticker", "title"}.issubset(item):
            continue
        entries.append(
            security_identity(
                cik=item["cik_str"],
                name=str(item["title"]),
                ticker=str(item["ticker"]),
                exchange=None,
            )
        )
    return entries


def search_security_master(
    entries: list[dict[str, Any]], query: str, limit: int = 8
) -> list[dict[str, Any]]:
    needle = query.strip().upper()
    ticker_needle = normalize_ticker(query)
    compact_needle = _identifier_token(query)
    ranked: list[tuple[tuple[int, int, str], dict[str, Any]]] = []
    for entry in entries:
        ticker = str(entry["ticker"])
        name = str(entry["name"])
        compact_ticker = _identifier_token(ticker)
        upper_name = name.upper()
        if compact_ticker == compact_needle or ticker == ticker_needle:
            rank = 0
        elif ticker.startswith(ticker_needle) or compact_ticker.startswith(compact_needle):
            rank = 1
        elif upper_name == needle:
            rank = 2
        elif upper_name.startswith(needle):
            rank = 3
        elif needle in upper_name:
            rank = 4
        else:
            continue
        ranked.append(((rank, len(ticker), ticker), entry))
    ranked.sort(key=lambda item: item[0])
    return [entry for _, entry in ranked[:limit]]


class SecProvider:
    def __init__(self) -> None:
        settings = get_settings()
        self.client = httpx.Client(
            headers={
                "User-Agent": settings.sec_user_agent,
                "Accept-Encoding": "gzip, deflate",
                "Host": "data.sec.gov",
            },
            timeout=settings.request_timeout_seconds,
            follow_redirects=True,
        )

    def close(self) -> None:
        self.client.close()

    def _get_json(self, url: str, host: str = "data.sec.gov") -> dict[str, Any]:
        try:
            response = self.client.get(url, headers={"Host": host})
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SecProviderError(f"SEC request failed for {url}: {exc}") from exc

    def resolve_ticker(self, ticker: str) -> dict[str, Any]:
        normalized = normalize_ticker(ticker)
        for item in self.security_master():
            if item["ticker"] == normalized:
                return item
        raise SecProviderError(f"Ticker {normalized} was not found in the SEC company list")

    def search(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        return search_security_master(self.security_master(), query, limit)

    def security_master(self) -> list[dict[str, Any]]:
        try:
            payload = self._get_json(SEC_TICKERS_EXCHANGE_URL, host="www.sec.gov")
        except SecProviderError:
            payload = self._get_json(SEC_TICKERS_URL, host="www.sec.gov")
        entries = parse_security_master(payload)
        if not entries:
            raise SecProviderError("SEC company list did not contain any searchable securities")
        return entries

    def company_facts(self, cik: str) -> dict[str, Any]:
        return self._get_json(SEC_FACTS_URL.format(cik=cik.zfill(10)))

    def submissions(self, cik: str) -> dict[str, Any]:
        return self._get_json(SEC_SUBMISSIONS_URL.format(cik=cik.zfill(10)))

    @staticmethod
    def recent_filings(submissions: dict[str, Any], limit: int = 20) -> list[dict[str, Any]]:
        recent = submissions.get("filings", {}).get("recent", {})
        keys = ["accessionNumber", "filingDate", "reportDate", "form", "primaryDocument"]
        rows = []
        for values in zip(*(recent.get(key, []) for key in keys), strict=False):
            accession, filed, reported, form, document = values
            if form not in {"10-K", "10-Q", "8-K"}:
                continue
            compact = accession.replace("-", "")
            cik = str(submissions["cik"])
            rows.append(
                {
                    "accession_number": accession,
                    "filing_date": date.fromisoformat(filed),
                    "report_date": date.fromisoformat(reported) if reported else None,
                    "form": form,
                    "primary_document": document,
                    "source_url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{compact}/{document}",
                }
            )
            if len(rows) >= limit:
                break
        return rows
