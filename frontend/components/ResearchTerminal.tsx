"use client";

import { FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  InlineNotification,
  SkeletonText,
  Tag,
  TextInput,
  Theme,
} from "@carbon/react";
import {
  ArrowRight,
  Calculator,
  ChartLineData,
  Chat,
  Compare,
  Dashboard,
  Document,
  Information,
  Moon,
  Purchase,
  Renew,
  Report,
  Rss,
  Search,
  Sun,
  WarningAlt,
} from "@carbon/icons-react";
import type { ComponentType } from "react";

import { fetchAnalysis, prefetchAnalysis, searchSecurities } from "@/lib/api";
import { analysisSectionPanelState, isAnalysisSectionLoaded, mergeAnalysisSection } from "@/lib/analysis-sections";
import { compactMoney, money, multiple, percent, titleCase } from "@/lib/format";
import type { Analysis, AnalysisSection, ComparableCompany, SecuritySearchResult } from "@/lib/types";
import { CompanyLogo } from "./CompanyLogo";

const FinancialChart = lazy(() => import("./FinancialChart").then((module) => ({ default: module.FinancialChart })));
const FinancialExplorer = lazy(() => import("./FinancialExplorer").then((module) => ({ default: module.FinancialExplorer })));
const MultipleValuationView = lazy(() => import("./MultipleValuationView").then((module) => ({ default: module.MultipleValuationView })));
const NewsView = lazy(() => import("./NewsView").then((module) => ({ default: module.NewsView })));
const StockPriceChart = lazy(() => import("./StockPriceChart").then((module) => ({ default: module.StockPriceChart })));

type PageKey = AnalysisSection;

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: ComponentType<{ size?: number }> }> = [
  { key: "overview", label: "Overview", icon: Dashboard },
  { key: "financials", label: "Financials", icon: ChartLineData },
  { key: "valuation", label: "Valuation", icon: Calculator },
  { key: "buyTarget", label: "Buy Target", icon: Purchase },
  { key: "comps", label: "Comps", icon: Compare },
  { key: "earnings", label: "Earnings", icon: Report },
  { key: "news", label: "News", icon: Rss },
  { key: "filings", label: "Filings", icon: Document },
  { key: "risks", label: "Risks", icon: WarningAlt },
  { key: "research", label: "AI Research · Preview", icon: Chat },
];

const RECENT_SEARCHES_KEY = "aplex-recent-securities";
const RECENT_SEARCH_LIMIT = 5;

export function ResearchTerminal({ initialAnalysis = null }: { initialAnalysis?: Analysis | null }) {
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [ticker, setTicker] = useState("AAPL");
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [analysis, setAnalysis] = useState<Analysis | null>(initialAnalysis);
  const [loading, setLoading] = useState(!initialAnalysis);
  const [loadingSection, setLoadingSection] = useState<Exclude<AnalysisSection, "overview"> | null>(null);
  const [forcedSection, setForcedSection] = useState<Exclude<AnalysisSection, "overview"> | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Partial<Record<AnalysisSection, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [manualRefreshStatus, setManualRefreshStatus] = useState<{ message: string; outcome: "success" | "error" } | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [searchResults, setSearchResults] = useState<SecuritySearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [highlightedResult, setHighlightedResult] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<SecuritySearchResult[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const rememberSecurity = useCallback((result: SecuritySearchResult) => {
    setRecentSearches((current) => {
      const next = [
        result,
        ...current.filter((item) => item.ticker !== result.ticker),
      ].slice(0, RECENT_SEARCH_LIMIT);
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("aplex-theme-premium");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      return;
    }
    setTheme("dark");
  }, []);

  useEffect(() => {
    try {
      const savedSearches = JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
      if (Array.isArray(savedSearches)) {
        setRecentSearches(
          savedSearches
            .filter((item): item is SecuritySearchResult => (
              typeof item === "object" &&
              item !== null &&
              typeof item.ticker === "string" &&
              typeof item.name === "string"
            ))
            .slice(0, RECENT_SEARCH_LIMIT),
        );
      }
    } catch {
      window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const hasVisibleSnapshot = requestVersion === 0 && initialAnalysis?.company.ticker === ticker;
    setLoading(!hasVisibleSnapshot);
    setLoadingSection(null);
    setSectionErrors({});
    setManualRefreshing(false);
    setManualRefreshStatus(null);
    if (!hasVisibleSnapshot) setAnalysis(null);
    setError(null);
    fetchAnalysis(ticker, controller.signal, "overview")
      .then((value) => {
        if (active) {
          setAnalysis(value);
          rememberSecurity({
            issuer_id: value.company.cik,
            security_id: `ticker:${value.company.ticker}`,
            listing_id: `${value.company.exchange ?? "US"}:${value.company.ticker}`,
            ticker: value.company.ticker,
            name: value.company.name,
            cik: value.company.cik,
            exchange: value.company.exchange ?? "US",
            mic: value.company.exchange ?? "US",
            security_type: "Common stock",
            coverage: "SEC filings",
          });
        }
      })
      .catch((requestError: Error) => {
        if (active && requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialAnalysis, ticker, requestVersion, rememberSecurity]);

  useEffect(() => {
    if (activePage === "overview" || !analysis || analysis.company.ticker !== ticker) {
      setLoadingSection(null);
      return;
    }
    if (isAnalysisSectionLoaded(analysis, activePage)) {
      setLoadingSection(null);
      return;
    }
    const requestedSection = activePage;
    const controller = new AbortController();
    let active = true;
    setLoadingSection(requestedSection);
    setSectionErrors((current) => ({ ...current, [requestedSection]: undefined }));
    const forceRefresh = forcedSection === requestedSection;
    fetchAnalysis(ticker, controller.signal, requestedSection, forceRefresh)
      .then((value) => {
        if (active) setAnalysis((current) => current && current.company.ticker === ticker
          ? mergeAnalysisSection(current, value, requestedSection)
          : value);
      })
      .catch((requestError: Error) => {
        if (active && requestError.name !== "AbortError") {
          setSectionErrors((current) => ({ ...current, [requestedSection]: requestError.message }));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingSection((current) => current === requestedSection ? null : current);
          setForcedSection((current) => current === requestedSection ? null : current);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activePage, analysis, forcedSection, ticker]);

  const retryAnalysisSection = useCallback((section: Exclude<AnalysisSection, "overview">) => {
    setForcedSection(section);
    setSectionErrors((current) => ({ ...current, [section]: undefined }));
    setAnalysis((current) => current ? {
      ...current,
      data_scope: "partial",
      loaded_sections: (current.loaded_sections ?? NAV_ITEMS.map((item) => item.key)).filter((item) => item !== section),
    } : current);
  }, []);

  const refreshCompanyData = useCallback(async () => {
    if (!analysis || manualRefreshing) return;
    const refreshTicker = ticker;
    const refreshSection = activePage;
    setManualRefreshing(true);
    setManualRefreshStatus(null);
    try {
      const refreshed = await fetchAnalysis(refreshTicker, undefined, refreshSection, true);
      setAnalysis((current) => {
        if (!current || current.company.ticker !== refreshTicker) return current;
        return refreshSection === "overview"
          ? refreshed
          : mergeAnalysisSection(current, refreshed, refreshSection);
      });
      setManualRefreshStatus({ message: "Data refreshed just now", outcome: "success" });
    } catch (refreshError) {
      setManualRefreshStatus({
        message: refreshError instanceof Error ? refreshError.message : "Refresh failed. Try again.",
        outcome: "error",
      });
    } finally {
      setManualRefreshing(false);
    }
  }, [activePage, analysis, manualRefreshing, ticker]);

  useEffect(() => {
    const query = tickerInput.trim();
    if (!searchOpen || !query || query.toUpperCase() === ticker) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchSecurities(query, controller.signal)
        .then((results) => {
          setSearchResults(results);
          setHighlightedResult(results.length ? 0 : -1);
        })
        .catch((searchError: Error) => {
          if (searchError.name !== "AbortError") {
            setSearchResults([]);
            setSearchOpen(false);
          }
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchOpen, ticker, tickerInput]);

  const uniqueRecentSearches = useMemo(() => {
    const resultTickers = new Set(searchResults.map((item) => item.ticker));
    return recentSearches.filter((item) => !resultTickers.has(item.ticker));
  }, [recentSearches, searchResults]);

  const searchOptions = useMemo(
    () => [...searchResults, ...uniqueRecentSearches],
    [searchResults, uniqueRecentSearches],
  );

  function selectSecurity(result: SecuritySearchResult) {
    prefetchAnalysis(result.ticker);
    rememberSecurity(result);
    setTickerInput(result.ticker);
    setTicker(result.ticker);
    setSearchOpen(false);
    setHighlightedResult(-1);
  }

  function submitTicker(event: FormEvent) {
    event.preventDefault();
    const normalized = tickerInput.trim().toUpperCase();
    if (normalized) {
      const exactMatch = [...searchResults, ...recentSearches].find((item) => item.ticker === normalized);
      if (exactMatch) {
        selectSecurity(exactMatch);
        return;
      }
      if (searchOpen && highlightedResult >= 0 && searchOptions[highlightedResult]) {
        selectSecurity(searchOptions[highlightedResult]);
        return;
      }
      setTicker(normalized);
      setSearchOpen(false);
    }
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("aplex-theme-premium", nextTheme);
  }

  function openCompanyProfile(nextTicker: string) {
    const normalized = nextTicker.trim().toUpperCase();
    if (!normalized) return;
    setTickerInput(normalized);
    setTicker(normalized);
    setActivePage("overview");
    setSearchOpen(false);
    setHighlightedResult(-1);
    window.scrollTo({ top: 0 });
  }

  return (
    <Theme theme={theme === "dark" ? "g100" : "white"}>
    <div className="terminal-shell" data-theme={theme}>
      <header className="topbar">
        <button type="button" className="brand-lockup" aria-label="Go to AplexAnalysis overview" onClick={() => openCompanyProfile("AAPL")}>
          <span className="brand-name"><strong>Aplex</strong>Analysis</span>
        </button>
        <div className="search-module">
          <label htmlFor="ticker-search">Search public companies</label>
          <form className="ticker-search" onSubmit={submitTicker}>
            <div className="search-field">
              <TextInput
                id="ticker-search"
                labelText="Ticker or company"
                hideLabel
                placeholder="Ticker or company, for example Mastercard"
                value={tickerInput}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="security-search-results"
                aria-expanded={searchOpen}
                aria-activedescendant={searchOpen && highlightedResult >= 0 ? `security-result-${highlightedResult}` : undefined}
                autoComplete="off"
                onPointerDown={() => {
                  setSearchOpen(true);
                  setHighlightedResult(searchOptions.length ? 0 : -1);
                }}
                onBlur={() => window.setTimeout(() => {
                  setSearchOpen(false);
                  setHighlightedResult(-1);
                }, 120)}
                onChange={(event) => {
                  setTickerInput(event.target.value);
                  setSearchResults([]);
                  setSearchOpen(true);
                  setHighlightedResult(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && searchOptions.length) {
                    event.preventDefault();
                    setSearchOpen(true);
                    setHighlightedResult((value) => (value + 1) % searchOptions.length);
                  } else if (event.key === "ArrowUp" && searchOptions.length) {
                    event.preventDefault();
                    setSearchOpen(true);
                    setHighlightedResult((value) => (value <= 0 ? searchOptions.length - 1 : value - 1));
                  } else if (event.key === "Escape") {
                    setSearchOpen(false);
                    setHighlightedResult(-1);
                  }
                }}
              />
              {searchOpen && (
                <div id="security-search-results" className="search-results" role="listbox" aria-label="Security search suggestions">
                  {searchResults.length > 0 && (
                    <div className="search-group-label" role="presentation">Matching companies</div>
                  )}
                  {searchResults.map((result, index) => (
                    <button
                      id={`security-result-${index}`}
                      key={result.listing_id}
                      type="button"
                      role="option"
                      aria-selected={index === highlightedResult}
                      className={index === highlightedResult ? "is-highlighted" : ""}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => {
                        setHighlightedResult(index);
                        prefetchAnalysis(result.ticker);
                      }}
                      onClick={() => selectSecurity(result)}
                    >
                      <CompanyLogo ticker={result.ticker} name={result.name} size="sm" alt="" />
                      <strong>{result.ticker}</strong>
                      <span>{result.name}</span>
                      <small>{result.exchange} / {result.mic}</small>
                    </button>
                  ))}
                  {uniqueRecentSearches.length > 0 && (
                    <div className="search-group-label" role="presentation">Recently searched</div>
                  )}
                  {uniqueRecentSearches.map((result, index) => {
                    const optionIndex = searchResults.length + index;
                    return (
                      <button
                        id={`security-result-${optionIndex}`}
                        key={`recent-${result.ticker}`}
                        type="button"
                        role="option"
                        aria-selected={optionIndex === highlightedResult}
                        className={optionIndex === highlightedResult ? "is-highlighted" : ""}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => {
                          setHighlightedResult(optionIndex);
                          prefetchAnalysis(result.ticker);
                        }}
                        onClick={() => selectSecurity(result)}
                      >
                        <CompanyLogo ticker={result.ticker} name={result.name} size="sm" alt="" />
                        <strong>{result.ticker}</strong>
                        <span>{result.name}</span>
                        <small>{result.exchange} / {result.mic}</small>
                      </button>
                    );
                  })}
                  {!searching && searchOptions.length === 0 && (
                    <p>{tickerInput.trim() ? "No matching SEC-reporting companies" : "Your recent searches will appear here."}</p>
                  )}
                </div>
              )}
              <span className="search-status" aria-live="polite">
                {searching ? "Searching securities" : searchResults.length ? `${searchResults.length} matches` : ""}
              </span>
            </div>
            <Button type="submit" renderIcon={Search} iconDescription="Run analysis">
              Analyze
            </Button>
          </form>
        </div>
        <div className="topbar-status">
          <div><span>Coverage</span><strong>SEC + public news</strong></div>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Research sections">
        <nav>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.key}
                className={activePage === item.key ? "nav-item active" : "nav-item"}
                aria-current={activePage === item.key ? "page" : undefined}
                onClick={() => setActivePage(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <span className="horizontal-scroll-hint nav-scroll-hint">Swipe sideways for more sections</span>
        <div className="sidebar-foot">
          <Information size={16} />
          <span>Research software. Not investment advice.</span>
        </div>
      </aside>

      <main className="workspace">
        {loading && <LoadingState ticker={ticker} />}
        {!loading && error && !analysis && <ErrorState ticker={ticker} error={error} retry={() => setRequestVersion((value) => value + 1)} />}
        {!loading && analysis && (
          <>
            <CompanyHeader
              analysis={analysis}
              refreshing={manualRefreshing}
              refreshStatus={manualRefreshStatus}
              onRefresh={refreshCompanyData}
            />
            {analysis.provenance.warnings.map((warning) => (
              <InlineNotification key={warning} kind="warning" lowContrast title="Source status" subtitle={warning} hideCloseButton />
            ))}
            <PageContent
              page={activePage}
              analysis={analysis}
              onSelectCompany={openCompanyProfile}
              loadingSection={loadingSection}
              sectionError={sectionErrors[activePage] ?? null}
              onRetrySection={retryAnalysisSection}
            />
          </>
        )}
      </main>
    </div>
    </Theme>
  );
}

function LoadingState({ ticker }: { ticker: string }) {
  return (
    <div className="loading-state" aria-live="polite">
      <div className="loading-heading">
        <SkeletonText heading width="22%" />
        <p>Retrieving and normalizing {ticker} filings</p>
      </div>
      <div className="skeleton-grid">
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="skeleton-cell" key={index}><SkeletonText paragraph lineCount={3} /></div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ ticker, error, retry }: { ticker: string; error: string; retry: () => void }) {
  return (
    <div className="error-state">
      <InlineNotification kind="error" title={`Could not analyze ${ticker}`} subtitle={error} hideCloseButton />
      <Button kind="tertiary" renderIcon={Renew} onClick={retry}>Try again</Button>
    </div>
  );
}

function freshnessTime(value: string | null | undefined, dateOnly = false) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-US", dateOnly
    ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
}

function freshnessDisplay(item: NonNullable<Analysis["freshness"]>["financials"], dateOnly = false) {
  if (item.status === "unavailable") return "Unavailable";
  return item.as_of ? freshnessTime(item.as_of, dateOnly) : "Timestamp not supplied";
}

function CompanyHeader({ analysis, refreshing, refreshStatus, onRefresh }: {
  analysis: Analysis;
  refreshing: boolean;
  refreshStatus: { message: string; outcome: "success" | "error" } | null;
  onRefresh: () => void;
}) {
  const classification = [analysis.company.sector, analysis.company.industry].filter(Boolean).join(" / ");
  const peg = analysis.valuation.growth_projection.peg_ratio;
  const freshness = analysis.freshness;
  const statusLabel = refreshing
    ? "Refreshing"
    : refreshStatus?.outcome === "error"
      ? "Refresh failed"
      : freshness?.page_status === "stale" || freshness?.page_status === "refreshing"
        ? "Stale"
        : "Fresh";
  const statusTone = statusLabel === "Refresh failed" ? "red" : statusLabel === "Stale" ? "warm-gray" : "green";
  return (
    <section className="company-header">
      <div className="company-identity">
        <CompanyLogo
          ticker={analysis.company.ticker}
          name={analysis.company.name}
          size="lg"
          priority
          className="company-avatar"
        />
        <div className="company-overview">
          <div className="company-title-row">
            <h1>{analysis.company.name}</h1>
            <span>{analysis.company.ticker}</span>
            <Tag type={statusTone}>{statusLabel}</Tag>
            <button
              type="button"
              className={`company-refresh-button${refreshing ? " is-refreshing" : ""}`}
              aria-label={refreshing ? "Refreshing data" : "Refresh data"}
              title={refreshing ? "Refreshing data" : "Refresh data"}
              disabled={refreshing}
              onClick={onRefresh}
            >
              <Renew size={16} />
            </button>
          </div>
          <span className="company-refresh-status" aria-live="polite">{refreshStatus?.message}</span>
          <p>{analysis.company.exchange || "US listed"} / {classification || "SEC reporting company"}</p>
          <div className="company-price-line">
            <strong>{money(analysis.quote.price)}</strong>
            <span>{analysis.quote.is_delayed ? "Delayed market price" : "Market price"}</span>
          </div>
          <small>
            As of {analysis.quote.as_of} via {analysis.quote.source_url ? (
              <a href={analysis.quote.source_url} target="_blank" rel="noreferrer">{analysis.quote.provider}</a>
            ) : analysis.quote.provider}
          </small>
        </div>
      </div>
      <div className="company-snapshot" aria-label="Company market snapshot">
        <div><span>Market cap</span><strong>{compactMoney(analysis.metrics.market_cap)}</strong></div>
        <div><span>P / E</span><strong>{multiple(analysis.metrics.pe)}</strong></div>
        <div><span>PEG</span><strong>{peg == null ? "N/A" : peg.toFixed(2)}</strong></div>
        <div><span>Price / book</span><strong>{multiple(analysis.metrics.price_to_book)}</strong></div>
      </div>
      {freshness && (
        <div className="freshness-strip" aria-label="Data freshness">
          <div><span>Financial filing</span><strong>{freshnessDisplay(freshness.financials, true)}</strong><small>{freshness.financials.status}</small></div>
          <div><span>Quote updated</span><strong>{freshnessDisplay(freshness.quote)}</strong><small>{freshness.quote.status}</small></div>
          <div><span>Estimates updated</span><strong>{freshnessDisplay(freshness.analyst_estimates)}</strong><small>{freshness.analyst_estimates.status}</small></div>
          <div><span>Comparable set</span><strong>{freshnessDisplay(freshness.comps)}</strong><small>{freshness.comps.status}</small></div>
        </div>
      )}
    </section>
  );
}

function PageContent({ page, analysis, onSelectCompany, loadingSection, sectionError, onRetrySection }: {
  page: PageKey;
  analysis: Analysis;
  onSelectCompany: (ticker: string) => void;
  loadingSection: Exclude<AnalysisSection, "overview"> | null;
  sectionError: string | null;
  onRetrySection: (section: Exclude<AnalysisSection, "overview">) => void;
}) {
  if (page !== "overview") {
    const panelState = analysisSectionPanelState(analysis, page, loadingSection, sectionError);
    if (panelState === "loading") return <DeferredPanel label={`Loading ${page} data`} />;
    if (panelState === "error") return <SectionErrorState section={page} error={sectionError ?? "Additional data is unavailable."} retry={() => onRetrySection(page)} />;
  }
  if (page === "financials") return <FinancialsView analysis={analysis} />;
  if (page === "valuation") return <Suspense fallback={<DeferredPanel label="Loading valuation workspace" />}><MultipleValuationView analysis={analysis} /></Suspense>;
  if (page === "buyTarget") return <BuyTargetView analysis={analysis} />;
  if (page === "comps") return <CompsView analysis={analysis} onSelectCompany={onSelectCompany} />;
  if (page === "earnings") return <EarningsView analysis={analysis} />;
  if (page === "news") return <Suspense fallback={<DeferredPanel label="Loading company news" />}><NewsView analysis={analysis} onRetry={() => onRetrySection("news")} /></Suspense>;
  if (page === "filings") return <FilingsView analysis={analysis} />;
  if (page === "risks") return <RisksView analysis={analysis} onRetry={() => onRetrySection("risks")} />;
  if (page === "research") return <ResearchView analysis={analysis} />;
  return <OverviewView analysis={analysis} />;
}

function SectionErrorState({ section, error, retry }: { section: Exclude<AnalysisSection, "overview">; error: string; retry: () => void }) {
  return (
    <div className="error-state section-error-state">
      <InlineNotification kind="error" title={`Could not load ${section}`} subtitle={error} hideCloseButton />
      <Button kind="tertiary" renderIcon={Renew} onClick={retry}>Try again</Button>
    </div>
  );
}

function DeferredPanel({ label }: { label: string }) {
  return <div className="market-chart-loading deferred-panel" role="status" aria-live="polite" aria-label={label}><span /><span /><span /></div>;
}

function OverviewView({ analysis }: { analysis: Analysis }) {
  const headline = analysis.headline;
  return (
    <div className="page-stack">
      <section className="overview-primary-grid">
        <Suspense fallback={<DeferredPanel label="Loading price history" />}>
          <StockPriceChart ticker={analysis.company.ticker} />
        </Suspense>
        <aside className="conviction-panel">
          <div className="conviction-heading">
            <div><span>APLEX SCORE</span><strong>{headline.score}<small>/100</small></strong></div>
            <Tag type={headline.score >= 70 ? "green" : headline.score >= 50 ? "cool-gray" : "red"}>{headline.rating}</Tag>
          </div>
          <p>Weighted across valuation, quality, growth, balance-sheet strength, allocation, earnings, momentum and risk.</p>
          <div className="conviction-values">
            <DataRow label="Fair value" value={money(headline.fair_value)} subvalue={`${percent(headline.upside)} from market`} />
            <DataRow label="Buy target" value={money(headline.buy_target)} subvalue={`${percent(analysis.buy_target.margin_of_safety)} safety margin`} />
            <DataRow label="Bear case" value={money(headline.bear_value)} />
            <DataRow label="Bull case" value={money(headline.bull_value)} />
          </div>
          <div className="conviction-foot">
            <span>Forward PEG</span>
            <strong>{analysis.valuation.growth_projection.peg_ratio == null ? "N/A" : analysis.valuation.growth_projection.peg_ratio.toFixed(2)}</strong>
            <small>Target: {analysis.valuation.growth_projection.target_peg.toFixed(1)} or lower</small>
          </div>
        </aside>
      </section>

      <section className="key-highlights">
        <div className="key-highlights-heading">
          <h3>Key highlights</h3>
          <span>Latest annual filing and current delayed price</span>
        </div>
        <div className="key-highlights-grid">
          <MetricCell label="Revenue" value={compactMoney(analysis.latest.revenue)} detail={`${percent(analysis.metrics.revenue_growth_yoy)} annual growth`} tone={(analysis.metrics.revenue_growth_yoy ?? 0) >= 0 ? "positive" : "negative"} />
          <MetricCell label="Net income" value={compactMoney(analysis.latest.net_income)} detail={`${percent(analysis.metrics.net_income_growth_yoy)} annual growth`} tone={(analysis.metrics.net_income_growth_yoy ?? 0) >= 0 ? "positive" : "negative"} />
          <MetricCell label="Free cash flow" value={compactMoney(analysis.latest.free_cash_flow)} detail={`${percent(analysis.metrics.fcf_growth_yoy)} annual growth`} tone={(analysis.metrics.fcf_growth_yoy ?? 0) >= 0 ? "positive" : "negative"} />
          <MetricCell label="P / E" value={multiple(analysis.metrics.pe)} detail="Current price / annual EPS" />
          <MetricCell label="Price / book" value={multiple(analysis.metrics.price_to_book)} detail="Market cap / book equity" />
        </div>
      </section>

      <section className="company-brief" aria-labelledby="company-brief-title">
        <div className="company-brief-heading">
          <Information size={18} aria-hidden="true" />
          <div>
            <h3 id="company-brief-title">What the company does</h3>
            <span>{analysis.company.sector || "Public company"}</span>
          </div>
        </div>
        <div className="company-brief-copy">
          <p>{analysis.company.description || `${analysis.company.name} is a public company that reports financial information to the SEC.`}</p>
          <a href={analysis.company.description_source_url} target="_blank" rel="noreferrer">
            Source: {analysis.company.description_source}
          </a>
        </div>
      </section>

      <section className="content-section">
        <SectionHeading title="Financial trajectory" detail="Annual SEC Company Facts, normalized to fiscal years" />
        <Suspense fallback={<DeferredPanel label="Loading financial chart" />}>
          <FinancialChart periods={analysis.financials} />
        </Suspense>
      </section>

      <section className="split-section">
        <div>
          <SectionHeading title="Key metrics" detail={`Latest fiscal year: ${analysis.financials.at(-1)?.fiscal_year}`} />
          <div className="metric-table">
            <DataRow label="Revenue" value={compactMoney(analysis.latest.revenue)} />
            <DataRow label="Revenue CAGR" value={percent(analysis.metrics.revenue_cagr)} />
            <DataRow label="Operating margin" value={percent(analysis.metrics.operating_margin)} />
            <DataRow label="Free cash flow" value={compactMoney(analysis.latest.free_cash_flow)} />
            <DataRow label="FCF margin" value={percent(analysis.metrics.fcf_margin)} />
            <DataRow label="ROIC" value={percent(analysis.metrics.roic)} />
            <DataRow label="Net debt" value={compactMoney(analysis.metrics.net_debt)} />
            <DataRow label="P / FCF" value={multiple(analysis.metrics.price_to_fcf)} />
          </div>
        </div>
        <div>
          <SectionHeading title="Score anatomy" detail="Metric-derived, no LLM judgment" />
          <div className="score-matrix">
            {Object.entries(analysis.score.categories).map(([category, score]) => (
              <div key={category}>
                <span>{titleCase(category)}</span>
                <strong>{score}</strong>
                <small>{percent(analysis.score.weights[category], 0)} weight</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="thesis-strip">
        <div>
          <span>MODEL READ</span>
          <h3>{headline.rating} at {money(headline.current_price)}</h3>
        </div>
        <p>{analysis.valuation.reverse_dcf.interpretation} {analysis.valuation.methodology}</p>
      </section>
    </div>
  );
}

function MetricCell({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className="metric-cell"><span>{label}</span><strong>{value}</strong><small className={tone}>{detail}</small></div>;
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return <div className="section-heading"><h3>{title}</h3><p>{detail}</p></div>;
}

function DataRow({ label, value, subvalue }: { label: string; value: string; subvalue?: string }) {
  return <div className="data-row"><span>{label}{subvalue && <small>{subvalue}</small>}</span><strong>{value}</strong></div>;
}

function FinancialsView({ analysis }: { analysis: Analysis }) {
  const estimates = analysis.analyst_estimates;
  return (
    <div className="page-stack">
      <section className="financials-intro">
        <div>
          <h2>Financial explorer</h2>
          <p>Compare annual income, profitability, cash generation and balance sheet strength from standardized SEC facts.</p>
        </div>
        <div className="coverage-summary">
          <span>History</span>
          <strong>{analysis.financials[0]?.fiscal_year}-{analysis.financials.at(-1)?.fiscal_year}</strong>
          <small>{analysis.financials.length} annual and {analysis.quarterly_financials.length} quarterly periods</small>
        </div>
      </section>
      <section className="financial-explorer-section">
        <Suspense fallback={<DeferredPanel label="Loading financial explorer" />}>
          <FinancialExplorer annualPeriods={analysis.financials} quarterlyPeriods={analysis.quarterly_financials} />
        </Suspense>
        <p className="table-note">Quarterly cash flow values are shown as stand-alone quarters. Q4 may be calculated as the fiscal-year total minus Q1, Q2 and Q3. Missing values are shown as N/A.</p>
      </section>
      <section className="analyst-estimates-section">
        <div className="analyst-estimates-heading">
          <div>
            <h3>Analyst EPS estimates</h3>
            <p>Forward consensus ranges for upcoming quarters and fiscal years.</p>
          </div>
          <a href={estimates.source_url} target="_blank" rel="noreferrer">Source: {estimates.provider}</a>
        </div>
        {estimates.quarterly.length || estimates.annual.length ? (
          <div className="estimate-tables-grid">
            <EstimateTable title="Quarterly estimates" rows={estimates.quarterly} />
            <EstimateTable title="Annual estimates" rows={estimates.annual} />
          </div>
        ) : (
          <div className="estimate-empty"><strong>No consensus estimates available</strong><span>Nasdaq did not return forward EPS estimates for this security.</span></div>
        )}
        <p className="estimate-disclosure">{estimates.disclosure}</p>
      </section>
    </div>
  );
}

function EstimateTable({ title, rows }: { title: string; rows: Analysis["analyst_estimates"]["quarterly"] }) {
  const eps = (value: number | null) => value == null ? "N/A" : `$${value.toFixed(2)}`;
  return (
    <div className="estimate-table-block">
      <h4>{title}</h4>
      {rows.length ? (
        <>
        <span className="horizontal-scroll-hint">Swipe sideways to see all estimate columns</span>
        <div className="estimate-table-scroll">
          <table className="research-table estimate-table">
            <thead><tr><th>Period</th><th>Consensus EPS</th><th>Range</th><th>Analysts</th><th>Revisions</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period}>
                  <th>{row.period}</th>
                  <td>{eps(row.consensus_eps)}</td>
                  <td>{eps(row.low_eps)} to {eps(row.high_eps)}</td>
                  <td>{row.analyst_count ?? "N/A"}</td>
                  <td><span className="revision-up">+{row.revisions_up ?? 0}</span> / <span className="revision-down">-{row.revisions_down ?? 0}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : <p className="estimate-table-empty">No estimates available.</p>}
    </div>
  );
}

function BuyTargetView({ analysis }: { analysis: Analysis }) {
  return (
    <div className="page-stack">
      <section className="buy-target-hero">
        <div><span>FAIR VALUE</span><strong>{money(analysis.buy_target.fair_value)}</strong></div>
        <div className="formula-sign">×</div>
        <div><span>SAFETY FACTOR</span><strong>{percent(1 - analysis.buy_target.margin_of_safety)}</strong></div>
        <div className="formula-sign">=</div>
        <div className="target-result"><span>APLEX BUY TARGET</span><strong>{money(analysis.buy_target.buy_target)}</strong></div>
      </section>
      <section className="split-section">
        <div><SectionHeading title="Margin of safety" detail={analysis.buy_target.methodology} /><div className="big-stat">{percent(analysis.buy_target.margin_of_safety)}</div></div>
        <div><SectionHeading title="Risk adjustments" detail="Positive values demand a larger discount" /><div className="metric-table">{Object.entries(analysis.buy_target.components).map(([key, value]) => <DataRow key={key} label={titleCase(key)} value={percent(value)} />)}</div></div>
      </section>
    </div>
  );
}

function CompsView({ analysis, onSelectCompany }: { analysis: Analysis; onSelectCompany: (ticker: string) => void }) {
  const target: ComparableCompany = {
    ticker: analysis.company.ticker,
    name: analysis.company.name,
    sector: analysis.company.sector,
    industry: analysis.company.industry,
    price: analysis.quote.price,
    market_cap: analysis.metrics.market_cap ?? null,
    revenue_growth: analysis.metrics.revenue_growth_yoy ?? null,
    net_income_growth: analysis.metrics.net_income_growth_yoy ?? null,
    gross_margin: analysis.metrics.gross_margin ?? null,
    operating_margin: analysis.metrics.operating_margin ?? null,
    fcf_margin: analysis.metrics.fcf_margin ?? null,
    roic: analysis.metrics.roic ?? null,
    pe: analysis.metrics.pe ?? null,
    price_to_book: analysis.metrics.price_to_book ?? null,
    price_fcf: analysis.metrics.price_to_fcf ?? null,
    fcf_yield: analysis.metrics.fcf_yield ?? null,
    fiscal_year: analysis.financials.at(-1)?.fiscal_year ?? 0,
    quote_as_of: analysis.quote.as_of,
    selection_reason: "The company currently being analyzed.",
    selection_score: 100,
    selection_factors: [],
    selection_source: analysis.company.description_source,
    selection_source_url: analysis.company.description_source_url,
  };
  const rows = [target, ...analysis.comps];
  const median = (values: Array<number | null>) => {
    const sorted = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const peerMedianPe = median(analysis.comps.map((company) => company.pe && company.pe > 0 ? company.pe : null));
  const peerMedianRevenueGrowth = median(analysis.comps.map((company) => company.revenue_growth));
  const peerMedianOperatingMargin = median(analysis.comps.map((company) => company.operating_margin));
  const growthClass = (value: number | null) => value == null ? "" : value >= 0 ? "is-positive" : "is-negative";
  const fiscalYears = [...new Set(rows.map((row) => row.fiscal_year).filter(Boolean))].sort((a, b) => b - a);
  const fiscalCoverage = fiscalYears.length === 1 ? `Fiscal ${fiscalYears[0]}` : `Fiscal years ${fiscalYears.join(", ")}`;
  const spread = (value: number | null, benchmark: number | null) => value == null || benchmark == null ? null : value - benchmark;
  const peSpread = peerMedianPe && target.pe ? target.pe / peerMedianPe - 1 : null;
  const spreadLabel = (value: number | null, unit: "percent" | "multiple") => {
    if (value == null) return "Peer comparison unavailable";
    if (unit === "multiple") return `${value >= 0 ? "+" : ""}${percent(value)} vs peer median`;
    return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pts vs peer median`;
  };

  return (
    <div className="page-stack comps-page">
      <section className="comps-hero" aria-labelledby="comps-heading">
        <div className="comps-hero-copy">
          <span>COMPARABLE COMPANY ANALYSIS</span>
          <h2 id="comps-heading">{analysis.company.name} against its closest peers</h2>
          <p>{analysis.comps.length ? `${analysis.comps.length} companies selected by industry, products, customers, business model, and scale.` : "No companies met the minimum peer-quality rule. Unrelated companies are intentionally excluded."}</p>
          <div className="comps-industry-line"><strong>{analysis.company.industry || "Industry not classified"}</strong><span>{analysis.company.sector || "SEC reporting company"}</span></div>
        </div>
        <div className="comps-universe-panel">
          <div><span>Selected peers</span><strong>{analysis.comps.length}</strong></div>
          <div><span>Candidates reviewed</span><strong>{analysis.peer_selection.candidates_considered}</strong></div>
          <small>Source: {analysis.peer_selection.source_provider}</small>
        </div>
      </section>

      <section className="comps-snapshot" aria-label="Target versus peer medians">
        <article><span>Valuation</span><strong>{multiple(target.pe)}</strong><small className={growthClass(peSpread)}>{spreadLabel(peSpread, "multiple")}</small></article>
        <article><span>Revenue growth</span><strong>{percent(target.revenue_growth)}</strong><small className={growthClass(spread(target.revenue_growth, peerMedianRevenueGrowth))}>{spreadLabel(spread(target.revenue_growth, peerMedianRevenueGrowth), "percent")}</small></article>
        <article><span>Operating margin</span><strong>{percent(target.operating_margin)}</strong><small className={growthClass(spread(target.operating_margin, peerMedianOperatingMargin))}>{spreadLabel(spread(target.operating_margin, peerMedianOperatingMargin), "percent")}</small></article>
        <article><span>Market value</span><strong>{compactMoney(target.market_cap)}</strong><small>{multiple(peerMedianPe)} peer median P / E</small></article>
      </section>

      {analysis.comps.length > 0 && (
        <section className="peer-directory" aria-labelledby="peer-directory-heading">
          <div className="comps-section-heading">
            <div><h3 id="peer-directory-heading">Peer directory</h3><p>Select a company to open its full AplexAnalysis profile.</p></div>
            <span>{analysis.comps.length} profiles</span>
          </div>
          <div className="peer-directory-grid">
            {analysis.comps.map((peer) => (
              <button key={peer.ticker} type="button" className="peer-profile-card" onClick={() => onSelectCompany(peer.ticker)} aria-label={`Open ${peer.name} profile`}>
                <div className="peer-profile-identity"><CompanyLogo ticker={peer.ticker} name={peer.name} size="md" /><div><strong>{peer.name}</strong><small>{peer.ticker}</small></div><ArrowRight size={18} /></div>
                <p>{peer.selection_reason}</p>
                <div className="peer-profile-metrics"><span><small>Market cap</small><strong>{compactMoney(peer.market_cap)}</strong></span><span><small>Revenue growth</small><strong className={growthClass(peer.revenue_growth)}>{percent(peer.revenue_growth)}</strong></span><span><small>P / E</small><strong>{multiple(peer.pe)}</strong></span></div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="comps-matrix-section" aria-labelledby="comps-matrix-heading">
        <div className="comps-section-heading">
          <div><h3 id="comps-matrix-heading">Comparison matrix</h3><p>Annual filing metrics with the latest available delayed market data.</p></div>
          <span>{rows.length} companies</span>
        </div>
        <span className="horizontal-scroll-hint">Swipe sideways to compare every metric</span>
        <div className="comps-matrix-scroll">
          <table className="comps-matrix-table">
            <thead>
              <tr className="comps-column-groups"><th rowSpan={2}>Company</th><th colSpan={1}>Scale</th><th colSpan={2}>Growth</th><th colSpan={2}>Profitability</th><th colSpan={2}>Valuation</th><th rowSpan={2}><span className="visually-hidden">Profile</span></th></tr>
              <tr><th>Market cap</th><th>Revenue</th><th>Earnings</th><th>Gross margin</th><th>Operating margin</th><th>P / E</th><th>Price / book</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isTarget = row.ticker === analysis.company.ticker;
                return (
                  <tr key={row.ticker} className={isTarget ? "is-target" : ""}>
                    <th scope="row">
                      <button type="button" className="comps-company-link" onClick={() => onSelectCompany(row.ticker)} aria-label={isTarget ? `Open ${row.name} overview` : `Open ${row.name} profile`}>
                        <CompanyLogo ticker={row.ticker} name={row.name} size="sm" className="comps-company-avatar" />
                        <span className="comps-company-copy"><strong>{row.name}</strong><small>{row.ticker}{isTarget ? " / Current company" : ""}</small></span>
                      </button>
                    </th>
                    <td>{compactMoney(row.market_cap)}</td>
                    <td className={growthClass(row.revenue_growth)}>{percent(row.revenue_growth)}</td>
                    <td className={growthClass(row.net_income_growth)}>{percent(row.net_income_growth)}</td>
                    <td>{percent(row.gross_margin)}</td>
                    <td>{percent(row.operating_margin)}</td>
                    <td>{multiple(row.pe)}</td>
                    <td>{multiple(row.price_to_book)}</td>
                    <td><button type="button" className="comps-open-profile" onClick={() => onSelectCompany(row.ticker)} aria-label={`Open ${row.name} profile`}><ArrowRight size={16} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!analysis.comps.length && <div className="comps-empty"><p>{analysis.provenance.comparables || "No strong operating peers were identified. The comparison stays empty instead of adding weak industry matches."}</p></div>}
        <div className="comps-methodology-v2">
          <Information size={16} />
          <div><strong>Peer methodology</strong><p>{analysis.provenance.comparables} {fiscalCoverage} data is shown where available.</p></div>
          <a href={analysis.peer_selection.source_url} target="_blank" rel="noreferrer">View source</a>
        </div>
      </section>

      {analysis.comps.length > 0 && (
        <section className="peer-rationale-v2" aria-labelledby="peer-rationale-heading">
          <div className="comps-section-heading">
            <div><h3 id="peer-rationale-heading">Why each peer belongs</h3><p>Industry similarity is weighted first, followed by products, customers, business model, and size.</p></div>
            <span>{analysis.peer_selection.selection_version}</span>
          </div>
          <div className="peer-rationale-list">
            {analysis.comps.map((peer) => (
              <article key={peer.ticker}>
                <button type="button" className="peer-rationale-link" onClick={() => onSelectCompany(peer.ticker)}>
                  <CompanyLogo ticker={peer.ticker} name={peer.name} size="xs" />
                  <span>{peer.ticker}</span><strong>{peer.name}</strong><ArrowRight size={16} />
                </button>
                <p>{peer.selection_reason}</p>
                <div className="peer-rationale-meta"><span>Relevance {peer.selection_score.toFixed(1)}</span>{peer.selection_factors.slice(0, 3).map((factor) => <span key={factor}>{factor}</span>)}</div>
                <a href={peer.selection_source_url} target="_blank" rel="noreferrer">{peer.selection_source}</a>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EarningsView({ analysis }: { analysis: Analysis }) {
  const latest = analysis.financials.at(-1)!;
  return <div className="page-stack"><section className="split-section"><div><SectionHeading title="Latest annual momentum" detail={`Fiscal ${latest.fiscal_year} versus prior year`} /><div className="score-matrix"><MetricCell label="Revenue growth" value={percent(analysis.metrics.revenue_growth_yoy)} detail="year over year" /><MetricCell label="EPS growth" value={percent(analysis.metrics.eps_growth_yoy)} detail="year over year" /><MetricCell label="FCF growth" value={percent(analysis.metrics.fcf_growth_yoy)} detail="year over year" /><MetricCell label="FCF conversion" value={percent(analysis.metrics.fcf_conversion)} detail="of net income" /></div></div><div><SectionHeading title="Earnings quality" detail="Programmatic stability assessment" /><div className="big-stat">{analysis.score.categories.earnings_quality}/100</div><p className="body-copy">{analysis.metrics.earnings_positive_years} of {analysis.metrics.history_years} available years were profitable. Operating-margin variability was {percent(analysis.metrics.operating_margin_volatility)}.</p></div></section></div>;
}

function filingDateLabel(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function fiscalPeriodForFiling(analysis: Analysis, filing: Analysis["filings"][number]) {
  if (!filing.report_date) return filing.form === "8-K" ? "Not applicable" : "Not identified";
  const period = [...analysis.financials, ...analysis.quarterly_financials]
    .find((candidate) => candidate.period_end === filing.report_date);
  if (!period) return filing.form === "8-K" ? "Not applicable" : "Not identified";
  return period.fiscal_quarter ? `Q${period.fiscal_quarter} FY ${period.fiscal_year}` : `FY ${period.fiscal_year}`;
}

function FilingsView({ analysis }: { analysis: Analysis }) {
  return (
    <div className="page-stack">
      <section className="table-section">
        <SectionHeading title="SEC filings" detail="Fiscal timing and submission dates are shown separately" />
        {analysis.filings.length ? (
          <table className="research-table">
            <thead><tr><th>Fiscal period</th><th>Report period ending</th><th>Filing form</th><th>Filing date</th><th>Accession</th><th>Source</th></tr></thead>
            <tbody>{analysis.filings.map((filing) => (
              <tr key={filing.accession_number}>
                <th>{fiscalPeriodForFiling(analysis, filing)}</th>
                <td>{filingDateLabel(filing.report_date)}</td>
                <td><Tag type="cool-gray">{filing.form}</Tag></td>
                <td>{filingDateLabel(filing.filing_date)}</td>
                <td className="mono">{filing.accession_number}</td>
                <td><a href={filing.source_url} target="_blank" rel="noreferrer">Open filing</a></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty-state"><Document size={32} /><h3>No filing index in offline mode</h3><p>Financial statement provenance is still available per metric through the API.</p></div>}
      </section>
    </div>
  );
}

function RisksView({ analysis, onRetry }: { analysis: Analysis; onRetry: () => void }) {
  const filedRisks = analysis.risks.filter((risk) => risk.kind === "filing_theme" || risk.severity === "filed");
  const quantitativeRisks = analysis.risks.filter((risk) => risk.kind === "quantitative_indicator" || risk.severity !== "filed");
  const filing = filedRisks[0];
  const filingDate = filing?.filing_date
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${filing.filing_date}T12:00:00Z`))
    : "Unavailable";
  return (
    <div className="page-stack risk-page">
      {filedRisks.length ? (
        <section className="risk-dossier" aria-labelledby="risk-dossier-heading">
          <header className="risk-dossier-header">
            <div>
              <span className="risk-kicker">ANNUAL FILING REVIEW</span>
              <h2 id="risk-dossier-heading">Key risks disclosed by {analysis.company.name}</h2>
              <p>Distinct themes summarized from the latest annual filing. The company does not rank these themes by severity.</p>
            </div>
            <div className="risk-dossier-count"><strong>{filedRisks.length}</strong><span>disclosed themes</span></div>
          </header>
          <div className="risk-filing-bar">
            <div><span>Document</span><strong>{filing?.form ?? "Annual filing"}</strong></div>
            <div><span>Section</span><strong>{filing?.item ?? "Risk Factors"}</strong></div>
            <div><span>Filed</span><strong>{filingDate}</strong></div>
            <div><span>Source</span>{filing?.source_url ? <a href={filing.source_url} target="_blank" rel="noreferrer">Open on SEC.gov <ArrowRight size={14} /></a> : <strong>Unavailable</strong>}</div>
          </div>
          <div className="risk-theme-list">
            {filedRisks.map((risk, index) => (
              <article key={risk.theme ?? risk.title}>
                <span className="risk-theme-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="risk-theme-copy">
                  <div className="risk-theme-label"><span>Company disclosed</span>{risk.form && <small>{risk.form}</small>}</div>
                  <h3>{risk.title}</h3>
                  <p>{risk.detail}</p>
                  {risk.evidence?.[0] && (
                    <details>
                      <summary>View filing evidence</summary>
                      <blockquote>{risk.evidence[0]}</blockquote>
                    </details>
                  )}
                </div>
              </article>
            ))}
          </div>
          <footer className="risk-method-note"><Information size={16} /><p>AplexAnalysis groups related filing statements into themes and keeps an evidence excerpt for review. Summaries are research aids, not a replacement for reading the full filing.</p></footer>
        </section>
      ) : (
        <section className="risk-fallback" aria-labelledby="risk-fallback-heading">
          <header><span className="risk-kicker">MODEL INDICATORS</span><h2 id="risk-fallback-heading">Quantitative risk flags</h2><p>The latest annual filing risk section could not be summarized, so these indicators use financial metrics and valuation expectations.</p></header>
          <div className="risk-indicator-list">
            {quantitativeRisks.map((risk) => <article key={risk.title}><Tag type={risk.severity === "high" ? "red" : risk.severity === "medium" ? "warm-gray" : "gray"}>{risk.severity.toUpperCase()}</Tag><div><h3>{risk.title}</h3><p>{risk.detail}</p></div></article>)}
          </div>
          <InlineNotification kind="warning" lowContrast title="Filing themes unavailable" subtitle="The annual filing could not be summarized. You can try the source again now." hideCloseButton />
          <Button kind="tertiary" renderIcon={Renew} onClick={onRetry}>Retry filing risks</Button>
        </section>
      )}
    </div>
  );
}

function ResearchView({ analysis }: { analysis: Analysis }) {
  const prompts = ["Why are margins changing?", "What growth does the market price imply?", "What are the largest quantified risks?"];
  return <div className="page-stack"><section className="research-empty"><Tag type="purple">PREVIEW</Tag><Chat size={40} /><h3>Filing-grounded AI Research preview</h3><p>This feature is not active yet. The retrieval layer is scaffolded, but no LLM provider is configured. Numerical analysis remains fully functional without AI.</p><div>{prompts.map((prompt) => <button key={prompt} type="button" disabled>{prompt}</button>)}</div><small>Planned: filing-grounded answers with direct SEC citations.</small></section><section className="thesis-strip"><div><span>AVAILABLE NOW</span><h3>Reverse DCF interpretation</h3></div><p>{analysis.valuation.reverse_dcf.interpretation}</p></section></div>;
}
