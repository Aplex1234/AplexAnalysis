from app.sample_data import FALLBACK_COMPANIES


def test_fallback_periods_are_self_identifying_after_persistence():
    periods = FALLBACK_COMPANIES["NVDA"]["periods"]
    providers = {
        source.get("provider")
        for period in periods
        for source in period["provenance"].values()
        if source.get("provider")
    }
    assert providers == {"Bundled SEC-derived fallback snapshot"}
