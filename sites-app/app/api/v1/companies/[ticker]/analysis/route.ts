import { NextResponse } from "next/server";
import {
  acquireRefreshLease,
  readCachedAnalysis,
  recordCompanyViewInBackground,
  recordRefreshFailure,
  scheduleBackgroundRefresh,
} from "@/lib/server/analysis-cache";
import {
  buildOverviewSnapshot,
  markSnapshotFreshness,
  rebuildAnalysisFromComponentCaches,
  refreshDueCompanies,
} from "@/lib/server/analysis-service";

async function refreshCachedAnalysis(ticker: string, listingId: string) {
  try {
    await rebuildAnalysisFromComponentCaches(ticker);
  } catch (error) {
    await recordRefreshFailure(listingId, error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const requestStartedAt = Date.now();
  try {
    const { ticker } = await context.params;
    const normalizedTicker = ticker.trim().toUpperCase();
    const searchParams = new URL(request.url).searchParams;
    const forceRefresh = searchParams.get("refresh") === "1";
    const overviewOnly = searchParams.get("view") === "overview";
    const cached = forceRefresh ? null : await readCachedAnalysis(normalizedTicker);

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
      const etag = `W/"analysis-${normalizedTicker}-${overviewOnly ? "overview" : "full"}-${cached.generatedAt}-${cached.isFresh ? "fresh" : "stale"}"`;
      const headers = {
        "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
        ETag: etag,
        "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
      };
      if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
      return NextResponse.json({
        data: overviewOnly ? buildOverviewSnapshot(analysis) : analysis,
        meta: {
          ticker: normalizedTicker,
          cache: cached.isFresh ? "hit" : "stale",
          cached_at: cached.generatedAt,
          fresh_until: cached.freshUntil,
          refreshing,
        },
      }, { headers });
    }

    const analysis = await rebuildAnalysisFromComponentCaches(normalizedTicker);
    const persisted = await readCachedAnalysis(normalizedTicker);
    const generatedAt = analysis.provenance.generated_at;
    const etag = `W/"analysis-${normalizedTicker}-${overviewOnly ? "overview" : "full"}-${generatedAt}-live"`;
    const headers = {
      "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
      ETag: etag,
      "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
    };
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({
      data: overviewOnly ? buildOverviewSnapshot(analysis) : analysis,
      meta: { ticker: normalizedTicker, cache: forceRefresh ? "refresh" : "miss", cached: Boolean(persisted) },
    }, { headers });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Analysis failed" },
      { status: 422 },
    );
  }
}
