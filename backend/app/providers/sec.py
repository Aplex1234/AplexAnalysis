from __future__ import annotations

from datetime import date
from typing import Any

import httpx

from ..config import get_settings

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"


class SecProviderError(RuntimeError):
    pass


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
        data = self._get_json(SEC_TICKERS_URL, host="www.sec.gov")
        normalized = ticker.upper().strip()
        for item in data.values():
            if item["ticker"].upper() == normalized:
                return {
                    "ticker": normalized,
                    "name": item["title"],
                    "cik": str(item["cik_str"]).zfill(10),
                }
        raise SecProviderError(f"Ticker {normalized} was not found in the SEC company list")

    def search(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        data = self._get_json(SEC_TICKERS_URL, host="www.sec.gov")
        needle = query.upper().strip()
        matches = []
        for item in data.values():
            ticker = item["ticker"].upper()
            name = item["title"]
            if ticker.startswith(needle) or needle in name.upper():
                matches.append({"ticker": ticker, "name": name, "cik": str(item["cik_str"]).zfill(10)})
        return sorted(matches, key=lambda value: (not value["ticker"].startswith(needle), len(value["ticker"])))[:limit]

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
