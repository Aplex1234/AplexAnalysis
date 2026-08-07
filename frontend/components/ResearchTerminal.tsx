"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Button,
  InlineNotification,
  NumberInput,
  SkeletonText,
  Tag,
  TextInput,
} from "@carbon/react";
import {
  Calculator,
  ChartLineData,
  Chat,
  Compare,
  Dashboard,
  Document,
  Information,
  Purchase,
  Renew,
  Report,
  Search,
  WarningAlt,
} from "@carbon/icons-react";
import type { ComponentType } from "react";

import { fetchAnalysis, runValuation, searchSecurities } from "@/lib/api";
import { compactMoney, money, multiple, percent, titleCase } from "@/lib/format";
import type { Analysis, DcfAssumptions, SecuritySearchResult } from "@/lib/types";
import { FinancialChart } from "./FinancialChart";

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

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    fetchAnalysis(ticker, controller.signal)
      .then((value) => {
        if (active) setAnalysis(value);
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
  }, [ticker, requestVersion]);

  useEffect(() => {
    const query = tickerInput.trim();
    if (!query) {
      setSearchResults([]);
      setSearchOpen(false);
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

  function selectSecurity(result: SecuritySearchResult) {
    setTickerInput(result.ticker);
    setTicker(result.ticker);
    setSearchOpen(false);
    setHighlightedResult(-1);
  }

  function submitTicker(event: FormEvent) {
    event.preventDefault();
    if (searchOpen && highlightedResult >= 0 && searchResults[highlightedResult]) {
      selectSecurity(searchResults[highlightedResult]);
      return;
    }
    const normalized = tickerInput.trim().toUpperCase();
    if (normalized) {
      setTicker(normalized);
      setSearchOpen(false);
    }
  }

  return (
    <div className="terminal-shell">
      <header className="topbar">
        <div className="brand-lockup" aria-label="AplexAnalysis home">
          <span className="brand-mark">A</span>
          <span>AplexAnalysis</span>
          <span className="brand-mode">RESEARCH</span>
        </div>
        <form className="ticker-search" onSubmit={submitTicker}>
          <div className="search-field">
            <TextInput
              id="ticker-search"
              labelText="Ticker or company"
              hideLabel
              placeholder="Search ticker or company"
              value={tickerInput}
              role="combobox"
              aria-autocomplete="list"
              aria-controls="security-search-results"
              aria-expanded={searchOpen}
              aria-activedescendant={highlightedResult >= 0 ? `security-result-${highlightedResult}` : undefined}
              autoComplete="off"
              onFocus={() => setSearchOpen(searchResults.length > 0)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
              onChange={(event) => setTickerInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && searchResults.length) {
                  event.preventDefault();
                  setSearchOpen(true);
                  setHighlightedResult((value) => (value + 1) % searchResults.length);
                } else if (event.key === "ArrowUp" && searchResults.length) {
                  event.preventDefault();
                  setSearchOpen(true);
                  setHighlightedResult((value) => (value <= 0 ? searchResults.length - 1 : value - 1));
                } else if (event.key === "Escape") {
                  setSearchOpen(false);
                }
              }}
            />
            {searchOpen && (
              <div id="security-search-results" className="search-results" role="listbox" aria-label="Matching securities">
                {searchResults.length ? searchResults.map((result, index) => (
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
                )) : !searching && <p>No matching SEC-listed companies</p>}
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
        <div className="topbar-status">
          <span>SEC primary</span>
          <span>USD</span>
        </div>
      </header>

      <aside className="sidebar" aria-label="Research sections">
        <div className="watchlist">
          <span>QUICK ACCESS</span>
          <div>
            {["AAPL", "NVDA", "COST"].map((quickTicker) => (
              <button
                key={quickTicker}
                type="button"
                className={ticker === quickTicker ? "is-current" : ""}
                onClick={() => {
                  setTickerInput(quickTicker);
                  setTicker(quickTicker);
                }}
              >
                {quickTicker}
              </button>
            ))}
          </div>
        </div>
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
  return (
    <section className="company-header">
      <div>
        <div className="company-title-row">
          <h1>{analysis.company.ticker}</h1>
          <span>{analysis.company.exchange}</span>
          <Tag type="blue">{analysis.provenance.financials === "live-sec" ? "LIVE SEC" : "SNAPSHOT"}</Tag>
        </div>
        <h2>{analysis.company.name}</h2>
        <p>{analysis.company.sector} / {analysis.company.industry}</p>
      </div>
      <div className="quote-block">
        <span>DELAYED PRICE</span>
        <strong>{money(analysis.quote.price)}</strong>
        <small>As of {analysis.quote.as_of} via {analysis.quote.provider}</small>
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
      <section className="headline-grid">
        <div className="score-panel">
          <span>APLEXANALYSIS SCORE</span>
          <strong>{headline.score}<small>/100</small></strong>
          <Tag type={headline.score >= 70 ? "green" : headline.score >= 50 ? "gray" : "red"}>{headline.rating}</Tag>
          <p>Transparent weighted score at the current market price.</p>
        </div>
        <MetricCell label="Fair value" value={money(headline.fair_value)} detail={percent(headline.upside) + " upside"} tone={headline.upside >= 0 ? "positive" : "negative"} />
        <MetricCell label="Buy target" value={money(headline.buy_target)} detail={`${percent(analysis.buy_target.margin_of_safety)} margin of safety`} />
        <MetricCell label="Bear case" value={money(headline.bear_value)} detail={percent(headline.bear_value / headline.current_price - 1)} />
        <MetricCell label="Base case" value={money(headline.base_value)} detail={percent(headline.base_value / headline.current_price - 1)} />
        <MetricCell label="Bull case" value={money(headline.bull_value)} detail={percent(headline.bull_value / headline.current_price - 1)} />
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
  return (
    <div className="page-stack">
      <section className="content-section">
        <SectionHeading title="Historical financials" detail="USD in millions except per-share data" />
        <FinancialChart periods={analysis.financials} />
      </section>
      <section className="table-section">
        <table className="research-table">
          <thead><tr><th>Fiscal year</th><th>Revenue</th><th>Gross profit</th><th>Operating income</th><th>Net income</th><th>Free cash flow</th><th>Diluted EPS</th></tr></thead>
          <tbody>
            {analysis.financials.map((period) => (
              <tr key={period.fiscal_year}>
                <th>{period.fiscal_year}</th>
                <td>{compactMoney(period.values.revenue)}</td>
                <td>{compactMoney(period.values.gross_profit)}</td>
                <td>{compactMoney(period.values.operating_income)}</td>
                <td>{compactMoney(period.values.net_income)}</td>
                <td>{compactMoney(period.values.free_cash_flow)}</td>
                <td>{money(period.values.diluted_eps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="table-note">Click through to the source filing from the Filings page. Calculated rows retain formula provenance in the API.</p>
      </section>
    </div>
  );
}

function ValuationView({ analysis, onAnalysisChange }: { analysis: Analysis; onAnalysisChange: (value: Analysis) => void }) {
  const [assumptions, setAssumptions] = useState<DcfAssumptions>(analysis.valuation.assumptions);
  const [running, setRunning] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

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
  const target = {
    ticker: analysis.company.ticker,
    revenue_growth: analysis.metrics.revenue_growth_yoy ?? 0,
    ebitda_margin: analysis.metrics.operating_margin ?? 0,
    fcf_margin: analysis.metrics.fcf_margin ?? 0,
    roic: analysis.metrics.roic ?? 0,
    pe: analysis.metrics.pe ?? 0,
    ev_revenue: 0,
    ev_ebitda: 0,
    price_fcf: analysis.metrics.price_to_fcf ?? 0,
  };
  const rows = [target, ...analysis.comps];
  return (
    <div className="page-stack">
      <section className="table-section">
        <SectionHeading title="Comparable companies" detail={`Peer snapshot dated ${analysis.provenance.peer_snapshot_as_of}; target metrics use current analysis`} />
        <table className="research-table comps-table">
          <thead><tr><th>Company</th><th>Revenue growth</th><th>EBITDA / Op. margin</th><th>FCF margin</th><th>ROIC</th><th>P / E</th><th>EV / Revenue</th><th>EV / EBITDA</th><th>P / FCF</th><th>FCF yield</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={String(row.ticker)} className={row.ticker === analysis.company.ticker ? "target-row" : ""}><th>{row.ticker}</th><td>{percent(Number(row.revenue_growth))}</td><td>{percent(Number(row.ebitda_margin))}</td><td>{percent(Number(row.fcf_margin))}</td><td>{percent(Number(row.roic))}</td><td>{multiple(Number(row.pe))}</td><td>{Number(row.ev_revenue) ? multiple(Number(row.ev_revenue)) : "N/A"}</td><td>{Number(row.ev_ebitda) ? multiple(Number(row.ev_ebitda)) : "N/A"}</td><td>{multiple(Number(row.price_fcf))}</td><td>{percent(1 / Number(row.price_fcf))}</td></tr>)}</tbody>
        </table>
        <InlineNotification kind="info" lowContrast hideCloseButton title="Comparability note" subtitle="Peer figures are dated reference snapshots. Enterprise-value metrics for the target require a live market-cap feed and are left unfilled instead of estimated." />
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
  return <div className="page-stack"><section className="risk-list"><SectionHeading title="Quantified risk flags" detail="Generated from financial metrics and valuation expectations" />{analysis.risks.map((risk) => <article key={risk.title}><Tag type={risk.severity === "high" ? "red" : risk.severity === "medium" ? "warm-gray" : "gray"}>{risk.severity.toUpperCase()}</Tag><div><h3>{risk.title}</h3><p>{risk.detail}</p></div></article>)}</section><InlineNotification kind="warning" lowContrast title="Coverage limitation" subtitle="Qualitative factors such as competition, concentration and management guidance require filing text analysis, which is scheduled for the next milestone." hideCloseButton /></div>;
}

function ResearchView({ analysis }: { analysis: Analysis }) {
  const prompts = ["Why are margins changing?", "What growth does the market price imply?", "What are the largest quantified risks?"];
  return <div className="page-stack"><section className="research-empty"><Chat size={40} /><h3>Filing-grounded research chat</h3><p>The retrieval layer is scaffolded, but no LLM provider is configured in this milestone. Numerical analysis remains fully functional without AI.</p><div>{prompts.map((prompt) => <button key={prompt} type="button" disabled>{prompt}</button>)}</div><code>OPENAI_API_KEY=your_key</code><small>Next step: chunk SEC filing text, create embeddings and return answers with filing citations.</small></section><section className="thesis-strip"><div><span>AVAILABLE NOW</span><h3>Reverse DCF interpretation</h3></div><p>{analysis.valuation.reverse_dcf.interpretation}</p></section></div>;
}
