"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  InlineNotification,
  NumberInput,
  SkeletonText,
  Tag,
  TextInput,
  Theme,
} from "@carbon/react";
import {
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
  Search,
  Sun,
  WarningAlt,
} from "@carbon/icons-react";
import type { ComponentType } from "react";

import { fetchAnalysis, runValuation, searchSecurities } from "@/lib/api";
import { compactMoney, money, multiple, percent, titleCase } from "@/lib/format";
import type { Analysis, ComparableCompany, DcfAssumptions, SecuritySearchResult } from "@/lib/types";
import { FinancialChart } from "./FinancialChart";
import { FinancialExplorer } from "./FinancialExplorer";
import { StockPriceChart } from "./StockPriceChart";

type PageKey = "overview" | "financials" | "valuation" | "buyTarget" | "comps" | "earnings" | "filings" | "risks" | "research";

const NAV_ITEMS: Array<{ key: PageKey; label: string; icon: ComponentType<{ size?: number }> }> = [
  { key: "overview", label: "Overview", icon: Dashboard },
  { key: "financials", label: "Financials", icon: ChartLineData },
  { key: "valuation", label: "Valuation", icon: Calculator },
  { key: "buyTarget", label: "Buy Target", icon: Purchase },
  { key: "comps", label: "Comps", icon: Compare },
  { key: "earnings", label: "Earnings", icon: Report },
  { key: "filings", label: "Filings", icon: Document },
  { key: "risks", label: "Risks", icon: WarningAlt },
  { key: "research", label: "AI Research", icon: Chat },
];

const DEFAULT_ASSUMPTIONS: DcfAssumptions = {
  forecast_years: 5,
  revenue_growth: 0.08,
  fcf_margin: 0.20,
  wacc: 0.09,
  terminal_growth: 0.025,
};

const RECENT_SEARCHES_KEY = "aplex-recent-securities";
const RECENT_SEARCH_LIMIT = 5;

export function ResearchTerminal() {
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [ticker, setTicker] = useState("AAPL");
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    setLoading(true);
    setError(null);
    fetchAnalysis(ticker, controller.signal)
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
  }, [ticker, requestVersion, rememberSecurity]);

  useEffect(() => {
    const query = tickerInput.trim();
    if (!query) {
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
          setSearchOpen(true);
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
  }, [tickerInput]);

  const uniqueRecentSearches = useMemo(() => {
    const resultTickers = new Set(searchResults.map((item) => item.ticker));
    return recentSearches.filter((item) => !resultTickers.has(item.ticker));
  }, [recentSearches, searchResults]);

  const searchOptions = useMemo(
    () => [...searchResults, ...uniqueRecentSearches],
    [searchResults, uniqueRecentSearches],
  );

  function selectSecurity(result: SecuritySearchResult) {
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

  return (
    <Theme theme={theme === "dark" ? "g100" : "white"}>
    <div className="terminal-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand-lockup" aria-label="AplexAnalysis home">
          <span className="brand-name"><strong>Aplex</strong>Analysis</span>
        </div>
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
                aria-activedescendant={highlightedResult >= 0 ? `security-result-${highlightedResult}` : undefined}
                autoComplete="off"
                onFocus={() => {
                  setSearchOpen(true);
                  setHighlightedResult(searchOptions.length ? 0 : -1);
                }}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                onChange={(event) => {
                  setTickerInput(event.target.value);
                  setSearchResults([]);
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
                      onMouseEnter={() => setHighlightedResult(index)}
                      onClick={() => selectSecurity(result)}
                    >
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
                        onMouseEnter={() => setHighlightedResult(optionIndex)}
                        onClick={() => selectSecurity(result)}
                      >
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
          <div><span>Coverage</span><strong>SEC filings</strong></div>
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
                onClick={() => setActivePage(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <Information size={16} />
          <span>Research software. Not investment advice.</span>
        </div>
      </aside>

      <main className="workspace">
        {loading && <LoadingState ticker={ticker} />}
        {!loading && error && <ErrorState ticker={ticker} error={error} retry={() => setRequestVersion((value) => value + 1)} />}
        {!loading && analysis && (
          <>
            <CompanyHeader analysis={analysis} />
            {analysis.provenance.warnings.map((warning) => (
              <InlineNotification key={warning} kind="warning" lowContrast title="Source status" subtitle={warning} hideCloseButton />
            ))}
            <PageContent
              page={activePage}
              analysis={analysis}
              onAnalysisChange={setAnalysis}
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

function CompanyHeader({ analysis }: { analysis: Analysis }) {
  const classification = [analysis.company.sector, analysis.company.industry].filter(Boolean).join(" / ");
  const peg = analysis.valuation.growth_projection.peg_ratio;
  return (
    <section className="company-header">
      <div className="company-identity">
        <div className="company-avatar" aria-hidden="true">{analysis.company.ticker.slice(0, 2)}</div>
        <div className="company-overview">
          <div className="company-title-row">
            <h1>{analysis.company.name}</h1>
            <span>{analysis.company.ticker}</span>
            <Tag type="green">{analysis.provenance.financials === "live-sec" ? "SEC verified" : "Snapshot"}</Tag>
          </div>
          <p>{analysis.company.exchange || "US listed"} / {classification || "SEC reporting company"}</p>
          <div className="company-price-line">
            <strong>{money(analysis.quote.price)}</strong>
            <span>Delayed market price</span>
          </div>
          <small>As of {analysis.quote.as_of} via {analysis.quote.provider}</small>
        </div>
      </div>
      <div className="company-snapshot" aria-label="Company market snapshot">
        <div><span>Market cap</span><strong>{compactMoney(analysis.metrics.market_cap)}</strong></div>
        <div><span>P / E</span><strong>{multiple(analysis.metrics.pe)}</strong></div>
        <div><span>PEG</span><strong>{peg == null ? "N/A" : peg.toFixed(2)}</strong></div>
        <div><span>Price / book</span><strong>{multiple(analysis.metrics.price_to_book)}</strong></div>
      </div>
    </section>
  );
}

function PageContent({ page, analysis, onAnalysisChange }: { page: PageKey; analysis: Analysis; onAnalysisChange: (value: Analysis) => void }) {
  if (page === "financials") return <FinancialsView analysis={analysis} />;
  if (page === "valuation") return <ValuationView analysis={analysis} onAnalysisChange={onAnalysisChange} />;
  if (page === "buyTarget") return <BuyTargetView analysis={analysis} />;
  if (page === "comps") return <CompsView analysis={analysis} />;
  if (page === "earnings") return <EarningsView analysis={analysis} />;
  if (page === "filings") return <FilingsView analysis={analysis} />;
  if (page === "risks") return <RisksView analysis={analysis} />;
  if (page === "research") return <ResearchView analysis={analysis} />;
  return <OverviewView analysis={analysis} />;
}

function OverviewView({ analysis }: { analysis: Analysis }) {
  const headline = analysis.headline;
  return (
    <div className="page-stack">
      <section className="overview-primary-grid">
        <StockPriceChart ticker={analysis.company.ticker} />
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
        <FinancialChart periods={analysis.financials} />
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
        <p>{analysis.valuation.reverse_dcf.interpretation} The blended fair value uses four deterministic methods.</p>
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
        <FinancialExplorer annualPeriods={analysis.financials} quarterlyPeriods={analysis.quarterly_financials} />
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
      ) : <p className="estimate-table-empty">No estimates available.</p>}
    </div>
  );
}

function ValuationView({ analysis, onAnalysisChange }: { analysis: Analysis; onAnalysisChange: (value: Analysis) => void }) {
  const [assumptions, setAssumptions] = useState<DcfAssumptions>(analysis.valuation.assumptions);
  const [running, setRunning] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const peg = analysis.valuation.growth_projection;

  async function calculate(event: FormEvent) {
    event.preventDefault();
    setRunning(true);
    setModelError(null);
    try {
      onAnalysisChange(await runValuation(analysis.company.ticker, assumptions));
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Valuation failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="valuation-summary">
        <div><span>BEAR</span><strong>{money(analysis.headline.bear_value)}</strong></div>
        <div className="base"><span>BLENDED FAIR VALUE</span><strong>{money(analysis.headline.fair_value)}</strong></div>
        <div><span>BULL</span><strong>{money(analysis.headline.bull_value)}</strong></div>
        <div><span>MARKET</span><strong>{money(analysis.headline.current_price)}</strong></div>
      </section>
      <section className="peg-model">
        <SectionHeading
          title="Five-year PEG valuation score"
          detail="Uses the model's projected revenue growth. Growth is entered as percentage points in the PEG formula."
        />
        <div className="peg-score-grid">
          <div><span>AVG. PROJECTED GROWTH</span><strong>{percent(peg.average_annual_growth)}</strong><small>next five fiscal years</small></div>
          <div><span>CURRENT P / E</span><strong>{peg.current_pe == null ? "N/A" : multiple(peg.current_pe)}</strong><small>price divided by annual EPS</small></div>
          <div className="peg-result"><span>PEG RATIO</span><strong>{peg.peg_ratio == null ? "N/A" : peg.peg_ratio.toFixed(2)}</strong><small>full score at {peg.target_peg.toFixed(1)} or lower</small></div>
          <div><span>VALUATION SCORE</span><strong>{peg.score}<small>/100</small></strong><small>30% of the overall score</small></div>
        </div>
        <div className="peg-formula">
          <span>FORMULA</span>
          <strong>{peg.current_pe == null ? "P/E unavailable" : peg.current_pe.toFixed(1)} / {(peg.average_annual_growth * 100).toFixed(1)}% growth = {peg.peg_ratio == null ? "N/A" : peg.peg_ratio.toFixed(2)} PEG</strong>
          <p>{peg.interpretation}</p>
        </div>
        <div className="peg-projection-table">
          <table className="research-table">
            <thead><tr><th>Fiscal year</th><th>Projected revenue</th><th>Projected net income</th><th>Annual growth</th></tr></thead>
            <tbody>{peg.projections.map((projection) => <tr key={projection.fiscal_year}><th>{projection.fiscal_year}</th><td>{compactMoney(projection.revenue)}</td><td>{compactMoney(projection.net_income)}</td><td>{percent(projection.growth_rate)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="split-section valuation-workbench">
        <form onSubmit={calculate}>
          <SectionHeading title="DCF assumptions" detail="Edit and rerun the complete valuation stack" />
          <div className="assumption-grid">
            <NumberInput id="forecast-years" label="Forecast years" min={3} max={10} value={assumptions.forecast_years} onChange={(_, state) => setAssumptions({ ...assumptions, forecast_years: Number(state.value) })} />
            <NumberInput id="revenue-growth" label="Revenue growth (%)" step={0.5} value={(assumptions.revenue_growth ?? 0) * 100} onChange={(_, state) => setAssumptions({ ...assumptions, revenue_growth: Number(state.value) / 100 })} />
            <NumberInput id="fcf-margin" label="FCF margin (%)" step={0.5} value={(assumptions.fcf_margin ?? 0) * 100} onChange={(_, state) => setAssumptions({ ...assumptions, fcf_margin: Number(state.value) / 100 })} />
            <NumberInput id="wacc" label="WACC (%)" step={0.25} value={assumptions.wacc * 100} onChange={(_, state) => setAssumptions({ ...assumptions, wacc: Number(state.value) / 100 })} />
            <NumberInput id="terminal-growth" label="Terminal growth (%)" step={0.25} value={assumptions.terminal_growth * 100} onChange={(_, state) => setAssumptions({ ...assumptions, terminal_growth: Number(state.value) / 100 })} />
          </div>
          {modelError && <InlineNotification kind="error" title="Model error" subtitle={modelError} lowContrast hideCloseButton />}
          <Button type="submit" disabled={running} renderIcon={Calculator}>{running ? "Calculating" : "Run valuation"}</Button>
        </form>
        <div>
          <SectionHeading title="Method outputs" detail={analysis.valuation.methodology} />
          <div className="metric-table">
            {Object.entries(analysis.valuation.methods).map(([method, value]) => <DataRow key={method} label={titleCase(method)} value={money(value)} />)}
          </div>
          <div className="reverse-dcf"><span>REVERSE DCF</span><strong>{percent(analysis.valuation.reverse_dcf.implied_revenue_growth)} implied growth</strong><p>{analysis.valuation.reverse_dcf.interpretation}</p></div>
        </div>
      </section>
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

function CompsView({ analysis }: { analysis: Analysis }) {
  const target: ComparableCompany = {
    ticker: analysis.company.ticker,
    name: analysis.company.name,
    sector: analysis.company.sector,
    industry: analysis.company.industry,
    price: analysis.quote.price,
    market_cap: analysis.metrics.market_cap ?? null,
    revenue_growth: analysis.metrics.revenue_growth_yoy ?? null,
    net_income_growth: analysis.metrics.net_income_growth_yoy ?? null,
    operating_margin: analysis.metrics.operating_margin ?? null,
    fcf_margin: analysis.metrics.fcf_margin ?? null,
    roic: analysis.metrics.roic ?? null,
    pe: analysis.metrics.pe ?? null,
    price_to_book: analysis.metrics.price_to_book ?? null,
    price_fcf: analysis.metrics.price_to_fcf ?? null,
    fcf_yield: analysis.metrics.fcf_yield ?? null,
    fiscal_year: analysis.financials.at(-1)?.fiscal_year ?? 0,
    quote_as_of: analysis.quote.as_of,
  };
  const rows = [target, ...analysis.comps];
  const peerPes = analysis.comps
    .map((company) => company.pe)
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const peerMedianPe = peerPes.length ? peerPes[Math.floor(peerPes.length / 2)] : null;
  const growthClass = (value: number | null) => value == null ? "" : value >= 0 ? "is-positive" : "is-negative";
  const fiscalYears = [...new Set(rows.map((row) => row.fiscal_year).filter(Boolean))].sort((a, b) => b - a);
  const fiscalCoverage = fiscalYears.length === 1 ? `Fiscal ${fiscalYears[0]}` : `Fiscal years ${fiscalYears.join(", ")}`;

  return (
    <div className="page-stack">
      <section className="comps-overview" aria-labelledby="comps-heading">
        <div className="comps-overview-heading">
          <div>
            <span>PEER BENCHMARK</span>
            <h2 id="comps-heading">{analysis.company.name}</h2>
            <p>{analysis.comps.length ? `Current valuation and operating performance against ${analysis.comps.length} comparable companies.` : "Current valuation and operating performance. Comparable-company data is temporarily unavailable."}</p>
          </div>
          <div className="comps-peer-count"><strong>{analysis.comps.length}</strong><span>peers loaded</span></div>
        </div>
        <div className="comps-benchmark-strip">
          <div><span>Target market cap</span><strong>{compactMoney(target.market_cap)}</strong></div>
          <div><span>Target P / E</span><strong>{multiple(target.pe)}</strong></div>
          <div><span>Peer median P / E</span><strong>{multiple(peerMedianPe)}</strong></div>
          <div><span>Target FCF margin</span><strong>{percent(target.fcf_margin)}</strong></div>
        </div>
      </section>

      <section className="table-section comps-section">
        <div className="comps-table-heading">
          <SectionHeading title="Operating and valuation comparison" detail="Annual filing metrics paired with the latest available delayed price" />
          <span>{analysis.comps.length ? `${rows.length} companies` : "Target only"}</span>
        </div>
        <div className="comps-table-scroll">
          <table className="research-table comps-table">
            <thead>
              <tr><th>Company</th><th>Market cap</th><th>Revenue growth</th><th>Income growth</th><th>Operating margin</th><th>FCF margin</th><th>ROIC</th><th>P / E</th><th>P / B</th><th>P / FCF</th><th>FCF yield</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isTarget = row.ticker === analysis.company.ticker;
                return (
                  <tr key={row.ticker} className={isTarget ? "target-row" : ""}>
                    <th scope="row">
                      <div className="comps-company-cell">
                        <span className="comps-symbol">{row.ticker}</span>
                        <span className="comps-company-name">{row.name}</span>
                        {isTarget && <span className="comps-target-label">Target</span>}
                      </div>
                    </th>
                    <td>{compactMoney(row.market_cap)}</td>
                    <td className={growthClass(row.revenue_growth)}>{percent(row.revenue_growth)}</td>
                    <td className={growthClass(row.net_income_growth)}>{percent(row.net_income_growth)}</td>
                    <td>{percent(row.operating_margin)}</td>
                    <td>{percent(row.fcf_margin)}</td>
                    <td>{percent(row.roic)}</td>
                    <td>{multiple(row.pe)}</td>
                    <td>{multiple(row.price_to_book)}</td>
                    <td>{multiple(row.price_fcf)}</td>
                    <td>{percent(row.fcf_yield)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="comps-methodology">
          <Information size={16} />
          <p><strong>How peers are built</strong><span>{analysis.provenance.comparables}. {fiscalCoverage} annual data is shown where available.</span></p>
        </div>
        {!analysis.comps.length && <div className="comps-empty"><p>No reliable peer rows were available for this company. The target metrics remain current, and the app will retry peer retrieval on the next analysis.</p></div>}
      </section>
    </div>
  );
}

function EarningsView({ analysis }: { analysis: Analysis }) {
  const latest = analysis.financials.at(-1)!;
  return <div className="page-stack"><section className="split-section"><div><SectionHeading title="Latest annual momentum" detail={`Fiscal ${latest.fiscal_year} versus prior year`} /><div className="score-matrix"><MetricCell label="Revenue growth" value={percent(analysis.metrics.revenue_growth_yoy)} detail="year over year" /><MetricCell label="EPS growth" value={percent(analysis.metrics.eps_growth_yoy)} detail="year over year" /><MetricCell label="FCF growth" value={percent(analysis.metrics.fcf_growth_yoy)} detail="year over year" /><MetricCell label="FCF conversion" value={percent(analysis.metrics.fcf_conversion)} detail="of net income" /></div></div><div><SectionHeading title="Earnings quality" detail="Programmatic stability assessment" /><div className="big-stat">{analysis.score.categories.earnings_quality}/100</div><p className="body-copy">{analysis.metrics.earnings_positive_years} of {analysis.metrics.history_years} available years were profitable. Operating-margin variability was {percent(analysis.metrics.operating_margin_volatility)}.</p></div></section></div>;
}

function FilingsView({ analysis }: { analysis: Analysis }) {
  return <div className="page-stack"><section className="table-section"><SectionHeading title="SEC filings" detail="Primary documents from EDGAR" />{analysis.filings.length ? <table className="research-table"><thead><tr><th>Form</th><th>Filed</th><th>Report period</th><th>Accession</th><th>Source</th></tr></thead><tbody>{analysis.filings.map((filing) => <tr key={filing.accession_number}><th>{filing.form}</th><td>{filing.filing_date}</td><td>{filing.report_date || "N/A"}</td><td className="mono">{filing.accession_number}</td><td><a href={filing.source_url} target="_blank" rel="noreferrer">Open filing</a></td></tr>)}</tbody></table> : <div className="empty-state"><Document size={32} /><h3>No filing index in offline mode</h3><p>Financial statement provenance is still available per metric through the API.</p></div>}</section></div>;
}

function RisksView({ analysis }: { analysis: Analysis }) {
  const hasFiledRisks = analysis.risks.some((risk) => risk.severity === "filed");
  return (
    <div className="page-stack">
      <section className="risk-list">
        <SectionHeading
          title={hasFiledRisks ? "Company-reported risk factors" : "Quantified risk flags"}
          detail={hasFiledRisks ? "Extracted from the risk section of the company's latest annual filing" : "Annual-filing risk text was unavailable, so these flags use financial metrics and valuation expectations"}
        />
        {analysis.risks.map((risk) => (
          <article key={risk.title}>
            <Tag type={risk.severity === "high" ? "red" : risk.severity === "medium" ? "warm-gray" : risk.severity === "filed" ? "blue" : "gray"}>{risk.severity.toUpperCase()}</Tag>
            <div>
              <h3>{risk.title}</h3>
              <p>{risk.detail}</p>
              {risk.source_url && <a className="risk-source-link" href={risk.source_url} target="_blank" rel="noreferrer">Open source filing</a>}
            </div>
          </article>
        ))}
      </section>
      {!hasFiledRisks && <InlineNotification kind="warning" lowContrast title="Filing text unavailable" subtitle="The site could not extract the latest annual-filing risk section for this company, so it is showing a quantitative fallback." hideCloseButton />}
    </div>
  );
}

function ResearchView({ analysis }: { analysis: Analysis }) {
  const prompts = ["Why are margins changing?", "What growth does the market price imply?", "What are the largest quantified risks?"];
  return <div className="page-stack"><section className="research-empty"><Chat size={40} /><h3>Filing-grounded research chat</h3><p>The retrieval layer is scaffolded, but no LLM provider is configured in this milestone. Numerical analysis remains fully functional without AI.</p><div>{prompts.map((prompt) => <button key={prompt} type="button" disabled>{prompt}</button>)}</div><code>OPENAI_API_KEY=your_key</code><small>Next step: chunk SEC filing text, create embeddings and return answers with filing citations.</small></section><section className="thesis-strip"><div><span>AVAILABLE NOW</span><h3>Reverse DCF interpretation</h3></div><p>{analysis.valuation.reverse_dcf.interpretation}</p></section></div>;
}
