from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import httpx

from ..config import get_settings


class MarketDataError(RuntimeError):
    pass


class NasdaqMarketProvider:
    """No-key delayed quote from Nasdaq's public market activity service."""

    def quote(self, ticker: str) -> dict[str, Any]:
        settings = get_settings()
        normalized = ticker.upper().strip()
        url = f"https://api.nasdaq.com/api/quote/{normalized}/info?assetclass=stocks"
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.1; financial research)",
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.nasdaq.com",
            "Referer": "https://www.nasdaq.com/",
        }
        try:
            response = httpx.get(
                url,
                headers=headers,
                timeout=settings.request_timeout_seconds,
                follow_redirects=True,
            )
            response.raise_for_status()
            payload = response.json().get("data") or {}
            quote = payload.get("primaryData") or payload.get("secondaryData") or {}
            price_text = quote.get("lastSalePrice")
            timestamp = quote.get("lastTradeTimestamp")
            if not price_text or not timestamp:
                raise MarketDataError(f"No market quote returned for {normalized}")
            price = float(str(price_text).replace("$", "").replace(",", "").strip())
            date_match = re.search(r"[A-Z][a-z]{2} \d{1,2}, \d{4}", str(timestamp))
            as_of = (
                datetime.strptime(date_match.group(0), "%b %d, %Y").date().isoformat() if date_match else str(timestamp)
            )
            return {
                "price": price,
                "as_of": as_of,
                "currency": "USD",
                "provider": "Nasdaq delayed quote",
                "source_url": f"https://www.nasdaq.com/market-activity/stocks/{normalized.lower()}",
                "is_delayed": not bool(quote.get("isRealTime", False)),
            }
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            raise MarketDataError(f"Market quote request failed for {normalized}: {exc}") from exc
