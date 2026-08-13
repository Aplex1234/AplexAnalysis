"use client";

import { useMemo, useState } from "react";
import { Launch, Rss } from "@carbon/icons-react";

import type { Analysis, NewsItem } from "@/lib/types";

type NewsFilter = "all" | NewsItem["scope"];

const FILTERS: Array<{ key: NewsFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "company", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "filing", label: "SEC filings" },
];

function formatPublished(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: new Date(timestamp).getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function scopeLabel(scope: NewsItem["scope"]) {
  if (scope === "filing") return "SEC filing";
  return scope === "industry" ? "Industry" : "Company";
}

function NewsRow({ item, ticker, lead = false }: { item: NewsItem; ticker: string; lead?: boolean }) {
  return (
    <article className={lead ? "news-item news-lead" : "news-item"}>
      <div className="news-item-index" aria-hidden="true">{item.scope === "filing" ? "SEC" : item.source.slice(0, 2).toUpperCase()}</div>
      <div className="news-item-body">
        <div className="news-meta">
          <span className={`news-scope news-scope-${item.scope}`}>{scopeLabel(item.scope)}</span>
          <span>{item.source}</span>
          <time dateTime={item.published_at}>{formatPublished(item.published_at)}</time>
          {item.matched_ticker && <span className="news-ticker-match">{ticker}</span>}
        </div>
        <h3><a href={item.url} target="_blank" rel="noreferrer">{item.title}<Launch size={15} aria-label="Open original coverage" /></a></h3>
        {item.summary && <p>{item.summary}</p>}
        {item.tickers.length > 1 && (
          <div className="news-related-tickers" aria-label="Related ticker symbols">
            {item.tickers.slice(0, 5).map((symbol) => <span key={symbol}>{symbol}</span>)}
          </div>
        )}
      </div>
    </article>
  );
}

export function NewsView({ analysis }: { analysis: Analysis }) {
  const [filter, setFilter] = useState<NewsFilter>("all");
  const items = useMemo(
    () => filter === "all" ? analysis.news.items : analysis.news.items.filter((item) => item.scope === filter),
    [analysis.news.items, filter],
  );
  const companyCount = analysis.news.items.filter((item) => item.scope === "company").length;
  const industryCount = analysis.news.items.filter((item) => item.scope === "industry").length;
  const filingCount = analysis.news.items.filter((item) => item.scope === "filing").length;
  const newsFreshness = analysis.freshness?.news;

  return (
    <div className="page-stack news-page">
      <section className="news-section" aria-labelledby="news-heading">
        <header className="news-header">
          <div>
            <span className="news-kicker">LATEST COVERAGE</span>
            <h2 id="news-heading">{analysis.company.name} news</h2>
            <p>Company coverage, ticker-matched stories, industry reporting and official SEC updates.</p>
          </div>
          <div className="news-count"><strong>{analysis.news.items.length}</strong><span>recent items</span></div>
        </header>

        <div className="news-filter" aria-label="Filter news coverage">
          {FILTERS.map((option) => (
            <button
              type="button"
              key={option.key}
              className={filter === option.key ? "active" : ""}
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
              <span>{option.key === "all" ? analysis.news.items.length : option.key === "company" ? companyCount : option.key === "industry" ? industryCount : filingCount}</span>
            </button>
          ))}
        </div>

        <div className="news-layout">
          <div className="news-list" aria-live="polite">
            {items.length ? items.map((item, index) => <NewsRow key={item.id} item={item} ticker={analysis.company.ticker} lead={index === 0} />) : (
              <div className="news-empty">
                <Rss size={30} />
                <h3>No recent {filter === "all" ? "coverage" : scopeLabel(filter as NewsItem["scope"]).toLowerCase()} found</h3>
                <p>Try another filter. Source coverage can vary by company and trading day.</p>
              </div>
            )}
          </div>

          <aside className="news-sources" aria-label="News source details">
            <span className="news-kicker">SOURCE DESK</span>
            <h3>Coverage details</h3>
            <dl>
              <div><dt>Updated</dt><dd>{formatPublished(analysis.news.fetched_at)}</dd></div>
              <div><dt>Status</dt><dd>{newsFreshness?.status ?? "live"}</dd></div>
              <div><dt>Company items</dt><dd>{companyCount}</dd></div>
              <div><dt>Industry items</dt><dd>{industryCount}</dd></div>
            </dl>
            <div className="news-provider-list">
              <span>Sources in this feed</span>
              {analysis.news.providers.map((provider) => <strong key={provider}>{provider}</strong>)}
            </div>
            {analysis.news.industry_query && <p className="news-industry-query">Industry lens: <strong>{analysis.news.industry_query}</strong></p>}
            {analysis.news.warnings.map((warning) => <p className="news-source-warning" key={warning}>{warning}</p>)}
            <p className="news-disclosure">Headlines and excerpts come from public aggregators and publishers. Open the original source before relying on a story. SEC items are official filings.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
