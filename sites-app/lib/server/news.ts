export type NewsScope = "company" | "industry" | "filing";

export type NewsItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  published_at: string;
  scope: NewsScope;
  tickers: string[];
  matched_ticker: boolean;
  image_url: string | null;
};

export type NewsFeed = {
  items: NewsItem[];
  fetched_at: string;
  providers: string[];
  industry_query: string | null;
  warnings: string[];
};

export type NewsCompany = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
};

export type NewsFiling = {
  form: string;
  filing_date: string | null;
  report_date: string | null;
  accession_number: string;
  source_url: string;
};

type YahooNewsRow = {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
  relatedTickers?: string[];
  thumbnail?: { resolutions?: Array<{ url?: string; width?: number }> };
};

type NasdaqNewsRow = {
  title?: string;
  publisher?: string;
  url?: string;
  created?: string;
  description?: string;
};

const FETCH_TIMEOUT_MS = 7_000;
const NEWS_LIMIT = 24;
const COMPANY_ITEM_LIMIT = 12;
const INDUSTRY_ITEM_LIMIT = 8;

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: unknown, limit = 360): string | null {
  if (typeof value !== "string") return null;
  const cleaned = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= limit) return cleaned;
  const clipped = cleaned.slice(0, limit - 1).replace(/\s+\S*$/, "").trim();
  return `${clipped}…`;
}

function safeUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return null;
  }
}

function isoDate(value: unknown, fallback = new Date(0).toISOString()): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1_000).toISOString();
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function companyTokens(name: string): string[] {
  const ignored = new Set(["company", "companies", "corporation", "corp", "inc", "incorporated", "limited", "ltd", "plc", "holdings", "group", "class"]);
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !ignored.has(token));
}

function mentionsCompany(value: string, ticker: string, name: string) {
  const tickerPattern = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(ticker.toUpperCase())}([^A-Z0-9]|$)`);
  if (tickerPattern.test(value.toUpperCase())) return true;
  const normalized = value.toLowerCase();
  return companyTokens(name).some((token) => normalized.includes(token));
}

function rssTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? "";
}

function titleKey(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 150);
}

function dedupeAndSort(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
    .filter((item) => {
      const key = titleKey(item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, NEWS_LIMIT);
}

async function fetchText(url: string, accept: string) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "Mozilla/5.0 (compatible; AplexAnalysis/0.2; financial research)",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`request returned ${response.status}`);
  return response.text();
}

async function fetchYahooCompanyNews(company: NewsCompany): Promise<NewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(company.ticker)}&quotesCount=0&newsCount=16&enableFuzzyQuery=false`;
  const payload = JSON.parse(await fetchText(url, "application/json")) as { news?: YahooNewsRow[] };
  return (payload.news ?? []).flatMap((row): NewsItem[] => {
    const title = cleanText(row.title, 220);
    const link = safeUrl(row.link);
    const relatedTickers = (row.relatedTickers ?? []).map((ticker) => ticker.toUpperCase());
    if (!title || !link || (!relatedTickers.includes(company.ticker) && !mentionsCompany(title, company.ticker, company.name))) return [];
    const image = [...(row.thumbnail?.resolutions ?? [])]
      .sort((left, right) => (right.width ?? 0) - (left.width ?? 0))
      .map((resolution) => safeUrl(resolution.url))
      .find(Boolean) ?? null;
    return [{
      id: `yahoo:${row.uuid ?? titleKey(title)}`,
      title,
      summary: null,
      url: link,
      source: cleanText(row.publisher, 80) ?? "Yahoo Finance",
      published_at: isoDate(row.providerPublishTime),
      scope: "company",
      tickers: relatedTickers,
      matched_ticker: relatedTickers.includes(company.ticker) || mentionsCompany(title, company.ticker, company.name),
      image_url: image,
    }];
  }).slice(0, COMPANY_ITEM_LIMIT);
}

async function fetchNasdaqCompanyNews(company: NewsCompany): Promise<NewsItem[]> {
  const symbol = company.ticker.replaceAll("-", ".");
  const url = `https://api.nasdaq.com/api/news/topic/articlebysymbol?q=${encodeURIComponent(`${symbol}|stocks`)}&limit=16&offset=0`;
  const payload = JSON.parse(await fetchText(url, "application/json, text/plain, */*")) as { data?: { rows?: NasdaqNewsRow[] } };
  return (payload.data?.rows ?? []).flatMap((row): NewsItem[] => {
    const title = cleanText(row.title, 220);
    const summary = cleanText(row.description, 300);
    const link = safeUrl(row.url, "https://www.nasdaq.com");
    const searchable = `${title ?? ""} ${summary ?? ""}`;
    if (!title || !link || !mentionsCompany(searchable, company.ticker, company.name)) return [];
    return [{
      id: `nasdaq:${titleKey(title)}`,
      title,
      summary,
      url: link,
      source: cleanText(row.publisher, 80) ?? "Nasdaq",
      published_at: isoDate(row.created),
      scope: "company",
      tickers: [company.ticker],
      matched_ticker: true,
      image_url: null,
    }];
  }).slice(0, COMPANY_ITEM_LIMIT);
}

async function fetchGoogleIndustryNews(company: NewsCompany, industryQuery: string): Promise<NewsItem[]> {
  const query = `${industryQuery} stocks`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(url, "application/rss+xml, application/xml, text/xml");
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  return blocks.flatMap((block, index): NewsItem[] => {
    const title = cleanText(rssTag(block, "title"), 220);
    const link = safeUrl(decodeEntities(rssTag(block, "link")));
    if (!title || !link) return [];
    const publisher = cleanText(rssTag(block, "source"), 80) ?? "Google News";
    const matchedTicker = mentionsCompany(title, company.ticker, company.name);
    return [{
      id: `google:${titleKey(title)}:${index}`,
      title,
      summary: null,
      url: link,
      source: publisher,
      published_at: isoDate(decodeEntities(rssTag(block, "pubDate"))),
      scope: "industry",
      tickers: matchedTicker ? [company.ticker] : [],
      matched_ticker: matchedTicker,
      image_url: null,
    }];
  }).slice(0, INDUSTRY_ITEM_LIMIT);
}

function filingItems(company: NewsCompany, filings: NewsFiling[]): NewsItem[] {
  const allowed = new Set(["8-K", "6-K", "10-Q", "10-K", "20-F", "40-F"]);
  const descriptions: Record<string, string> = {
    "8-K": "A current report covering a material company event or update.",
    "6-K": "A foreign issuer report furnished to the SEC.",
    "10-Q": "The company's latest quarterly financial and operating report.",
    "10-K": "The company's annual financial, business and risk disclosure.",
    "20-F": "The company's annual report as a foreign private issuer.",
    "40-F": "The company's annual report as a Canadian foreign private issuer.",
  };
  return filings
    .filter((filing) => allowed.has(filing.form) && filing.filing_date && safeUrl(filing.source_url))
    .slice(0, 4)
    .map((filing) => ({
      id: `sec:${filing.accession_number}`,
      title: `${company.name} filed Form ${filing.form}`,
      summary: descriptions[filing.form] ?? "A new company filing is available from SEC EDGAR.",
      url: safeUrl(filing.source_url)!,
      source: "SEC EDGAR",
      published_at: isoDate(`${filing.filing_date}T12:00:00Z`),
      scope: "filing" as const,
      tickers: [company.ticker],
      matched_ticker: true,
      image_url: null,
    }));
}

export async function fetchCompanyNews(company: NewsCompany, filings: NewsFiling[]): Promise<NewsFeed> {
  const fetchedAt = new Date().toISOString();
  const industryQuery = cleanText(company.industry || company.sector, 100);
  const jobs: Array<{ provider: string; promise: Promise<NewsItem[]> }> = [
    { provider: "Yahoo Finance", promise: fetchYahooCompanyNews(company) },
    { provider: "Nasdaq", promise: fetchNasdaqCompanyNews(company) },
  ];
  if (industryQuery) jobs.push({ provider: "Google News", promise: fetchGoogleIndustryNews(company, industryQuery) });

  const settled = await Promise.allSettled(jobs.map((job) => job.promise));
  const providers = ["SEC EDGAR"];
  const warnings: string[] = [];
  const items = filingItems(company, filings);
  settled.forEach((result, index) => {
    const provider = jobs[index].provider;
    if (result.status === "fulfilled") {
      items.push(...result.value);
      providers.push(provider);
    } else {
      warnings.push(`${provider} coverage is temporarily unavailable.`);
    }
  });

  return {
    items: dedupeAndSort(items),
    fetched_at: fetchedAt,
    providers,
    industry_query: industryQuery,
    warnings,
  };
}

export function emptyNewsFeed(): NewsFeed {
  return {
    items: [],
    fetched_at: new Date().toISOString(),
    providers: [],
    industry_query: null,
    warnings: [],
  };
}
