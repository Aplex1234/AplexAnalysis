import { NextResponse } from "next/server";
import type { AnalysisSection } from "@/lib/types";
import {
  acquireCacheRefreshLease,
  acquireRefreshLease,
  readCachedAnalysis,
  recordCompanyViewInBackground,
  recordRefreshFailure,
  releaseCacheRefreshLease,
  scheduleBackgroundRefresh,
} from "@/lib/server/analysis-cache";
import {
  buildOverviewSnapshot,
  buildSectionSnapshot,
  markSnapshotFreshness,
  rebuildAnalysisFromComponentCaches,
  rebuildAnalysisSectionFromComponentCaches,
  rebuildOverviewFromComponentCaches,
  refreshDueCompanies,
} from "@/lib/server/analysis-service";
import { normalizeTicker } from "@/lib/server/security-master";

const SECTION_VIEWS = new Set<AnalysisSection>(["financials", "valuation", "buyTarget", "comps", "earnings", "news", "filings", "risks", "research"]);

async function refreshCachedAnalysis(ticker: string, listingId: string) {
  try {
    await rebuildAnalysisFromComponentCaches(ticker);
  } catch (error) {
    await recordRefreshFailure(listingId, error);
  }
}

async function warmFullAnalysis(ticker: string) {
  const leaseKey = `analysis:${ticker}`;
  if (!await acquireCacheRefreshLease(leaseKey)) return;
  try {
    await rebuildAnalysisFromComponentCaches(ticker);
  } catch {
    // Overview remains usable when optional background enrichment fails.
  } finally {
    await releaseCacheRefreshLease(leaseKey);
  }
}

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const requestStartedAt = Date.now();
  try {
    const { ticker } = await context.params;
    const normalizedTicker = normalizeTicker(ticker);
    const searchParams = new URL(request.url).searchParams;
    const forceRefresh = searchParams.get("refresh") === "1";
    const requestedView = searchParams.get("view");
    const overviewOnly = requestedView === "overview";
    const requestedSection = SECTION_VIEWS.has(requestedView as AnalysisSection) ? requestedView as AnalysisSection : null;
    const responseScope = overviewOnly ? "overview" : requestedSection ?? "full";
    const cached = forceRefresh || requestedSection ? null : await readCachedAnalysis(normalizedTicker);

    if (cached) {
      let refreshing = false;
      if (!cached.isFresh && await acquireRefreshLease(cached.listingId)) {
        refreshing = await scheduleBackgroundRefresh(refreshCachedAnalysis(normalizedTicker, cached.listingId));
        if (!refreshing) await recordRefreshFailure(cached.listingId, "Background refresh is unavailable in this runtime");
      }
      await recordCompanyViewInBackground(normalizedTicker, cached.listingId);
      if (cached.isFresh) {
        await scheduleBackgroundRefresh(refreshDueCompanies(1, normalizedTicker));
      }
      const analysis = markSnapshotFreshness(cached.analysis, cached.isFresh ? "cached" : refreshing ? "refreshing" : "stale");
      const etag = `W/"analysis-${normalizedTicker}-${responseScope}-${cached.generatedAt}-${cached.isFresh ? "fresh" : "stale"}"`;
      const headers = {
        "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
        ETag: etag,
        "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
      };
      if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
      return NextResponse.json({
        data: overviewOnly ? buildOverviewSnapshot(analysis) : requestedSection ? buildSectionSnapshot(analysis, requestedSection) : analysis,
        meta: {
          ticker: normalizedTicker,
          cache: cached.isFresh ? "hit" : "stale",
          cached_at: cached.generatedAt,
          fresh_until: cached.freshUntil,
          refreshing,
        },
      }, { headers });
    }

    const analysis = overviewOnly
      ? await rebuildOverviewFromComponentCaches(normalizedTicker, forceRefresh)
      : requestedSection
        ? await rebuildAnalysisSectionFromComponentCaches(normalizedTicker, requestedSection, forceRefresh)
        : await rebuildAnalysisFromComponentCaches(normalizedTicker);
    if (overviewOnly) await scheduleBackgroundRefresh(warmFullAnalysis(normalizedTicker));
    const persisted = await readCachedAnalysis(normalizedTicker);
    const generatedAt = analysis.provenance.generated_at;
    const etag = `W/"analysis-${normalizedTicker}-${responseScope}-${generatedAt}-live"`;
    const headers = {
      "Cache-Control": forceRefresh ? "no-store" : "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
      ETag: etag,
      "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
    };
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({
      data: analysis,
      meta: { ticker: normalizedTicker, cache: forceRefresh ? "refresh" : "miss", cached: Boolean(persisted) },
    }, { headers });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Analysis failed" },
      { status: 422 },
    );
  }
}
