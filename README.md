# AplexAnalysis

AplexAnalysis is a transparent equity-research terminal. Enter a US-listed ticker and the application retrieves SEC Company Facts, normalizes annual financial statements, calculates key metrics, runs a multi-method valuation, applies a dynamic margin of safety, and produces a reproducible 0 to 100 attractiveness score.

## What works in this milestone

- SEC ticker resolution, Company Facts ingestion and recent 10-K, 10-Q and 8-K links
- Delayed quote retrieval from Nasdaq's public market activity service
- SQLite development storage with a PostgreSQL-ready SQLAlchemy model
- Five-year annual statement normalization with metric-level provenance
- Revenue, earnings, cash flow, margins, ROIC, ROE, leverage, dilution, buyback and valuation metrics
- Bear, Base and Bull DCF cases with editable assumptions
- Comparable, growth-adjusted and normalized-multiple valuation methods
- Reverse DCF implied growth
- Dynamic Buy Target margin of safety
- Eight-category AplexAnalysis Score with visible formulas and weights
- Professional responsive terminal with Overview, Financials, Valuation, Buy Target, Comps, Earnings, Filings, Risks and AI Research areas
- Offline SEC-derived fallback snapshots for AAPL, NVDA and COST

## Local setup

1. Copy `.env.example` to `.env` and replace the SEC contact email in `SEC_USER_AGENT`.
2. Create a Python environment and install `backend/requirements-dev.txt`.
3. From `backend`, run `uvicorn app.main:app --reload`.
4. From `frontend`, run `npm install` followed by `npm run dev`.
5. Open `http://localhost:3000`.

The frontend proxies `/api` to `http://127.0.0.1:8000` by default. Set `API_PROXY_URL` when the backend is hosted elsewhere.

The API documentation is available at `http://localhost:8000/docs`.

## Accuracy and provenance

SEC values are selected from annual 10-K facts, de-duplicated by fiscal year, and retain taxonomy tag, filing date, accession number and source URL. Free cash flow and diluted EPS are derived with explicit formulas. If live SEC or delayed quote retrieval fails, the app clearly labels and dates its fallback snapshots.

Peer data in this milestone is a dated reference snapshot, not a live feed. Enterprise-value multiples for the target are intentionally left unavailable when a live market-cap feed is absent. This avoids invented precision.

## Methodology

The blended fair value is 55% DCF, 20% peer P/E, 15% growth-adjusted P/E and 10% normalized P/E. The score weights are valuation 30%, quality 20%, growth 15%, financial strength 10%, capital allocation 10%, earnings quality 5%, momentum 5% and risk 5%.

AI research is scaffolded but intentionally disabled until a provider and filing citation index are configured. No LLM is used for numerical scores or valuation outputs.

## Tests

From `backend`, run `pytest`. Tests verify all three milestone tickers produce finite valuations, bounded scores and buy targets below fair value. They also check that conservative DCF assumptions reduce estimated value.

## Disclaimer

This software is for research and education. It is not investment advice. Verify source filings and assumptions before making financial decisions.
