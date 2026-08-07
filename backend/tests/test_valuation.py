import math

from app.sample_data import FALLBACK_COMPANIES, PEER_SNAPSHOTS
from app.schemas import DcfAssumptions
from app.services.metrics import calculate_metrics
from app.services.scoring import calculate_buy_target, calculate_scores
from app.services.valuation import calculate_valuation


def _analyze(ticker: str):
    company = FALLBACK_COMPANIES[ticker]
    periods = company["periods"]
    metrics = calculate_metrics(periods, company["price"])
    valuation = calculate_valuation(periods, metrics, company["price"], DcfAssumptions(), PEER_SNAPSHOTS[ticker])
    score = calculate_scores(metrics, valuation)
    target = calculate_buy_target(metrics, valuation, score)
    return valuation, score, target


def test_all_supported_tickers_produce_finite_outputs():
    for ticker in ("AAPL", "NVDA", "COST"):
        valuation, score, target = _analyze(ticker)
        assert math.isfinite(valuation["base_value"])
        assert 0 <= score["overall"] <= 100
        assert target["buy_target"] < valuation["base_value"]
        assert 0.08 <= target["margin_of_safety"] <= 0.35


def test_more_conservative_assumptions_reduce_dcf():
    company = FALLBACK_COMPANIES["AAPL"]
    metrics = calculate_metrics(company["periods"], company["price"])
    base = calculate_valuation(company["periods"], metrics, company["price"], DcfAssumptions(), PEER_SNAPSHOTS["AAPL"])
    conservative = calculate_valuation(
        company["periods"],
        metrics,
        company["price"],
        DcfAssumptions(revenue_growth=0.02, wacc=0.12, terminal_growth=0.015),
        PEER_SNAPSHOTS["AAPL"],
    )
    assert conservative["methods"]["dcf"] < base["methods"]["dcf"]
