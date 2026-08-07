from app.sample_data import FALLBACK_COMPANIES
from app.services.metrics import calculate_metrics


def test_aapl_metrics_are_reproducible():
    periods = FALLBACK_COMPANIES["AAPL"]["periods"]
    metrics = calculate_metrics(periods, 243.85)
    assert 0.08 < metrics["revenue_cagr"] < 0.10
    assert 0.25 < metrics["fcf_margin"] < 0.30
    assert metrics["share_change"] < 0


def test_supported_companies_have_five_years():
    assert all(len(company["periods"]) >= 5 for company in FALLBACK_COMPANIES.values())
