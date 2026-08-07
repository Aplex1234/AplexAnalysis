from app.providers.sec import parse_security_master, search_security_master

SAMPLE_MASTER = {
    "fields": ["cik", "name", "ticker", "exchange"],
    "data": [
        [320193, "Apple Inc.", "AAPL", "Nasdaq"],
        [1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],
        [1652044, "Alphabet Inc.", "GOOGL", "Nasdaq"],
        [1067983, "Berkshire Hathaway Inc.", "BRK-B", "NYSE"],
    ],
}


def test_share_class_search_resolves_common_separator() -> None:
    results = search_security_master(parse_security_master(SAMPLE_MASTER), "BRK.B")

    assert results[0]["ticker"] == "BRK-B"
    assert results[0]["exchange"] == "NYSE"
    assert results[0]["mic"] == "XNYS"
    assert results[0]["issuer_id"] == "sec-cik:0001067983"
    assert results[0]["listing_id"] == "listing:xnys:brk-b"


def test_search_keeps_distinct_share_classes() -> None:
    results = search_security_master(parse_security_master(SAMPLE_MASTER), "GOOG")

    assert [result["ticker"] for result in results[:2]] == ["GOOG", "GOOGL"]
    assert results[0]["security_id"] != results[1]["security_id"]


def test_company_name_search_returns_stable_identity() -> None:
    results = search_security_master(parse_security_master(SAMPLE_MASTER), "Apple")

    assert results[0]["ticker"] == "AAPL"
    assert results[0]["issuer_id"] == "sec-cik:0000320193"
    assert results[0]["security_type"] == "Equity"
