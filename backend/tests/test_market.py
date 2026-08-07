from app.providers.market import NasdaqMarketProvider


def test_market_provider_is_exposed_through_stable_interface():
    provider = NasdaqMarketProvider()
    assert callable(provider.quote)
