import { NextResponse } from "next/server";
import {
  acquireRefreshLease,
  readCachedAnalysis,
  recordCompanyView,
  recordRefreshFailure,
  scheduleBackgroundRefresh,
} from "@/lib/server/analysis-cache";
import {
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
  try {
    const { ticker } = await context.params;
    const normalizedTicker = ticker.trim().toUpperCase();
    const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
    const cached = forceRefresh ? null : await readCachedAnalysis(normalizedTicker);

    if (cached) {
      let refreshing = false;
      if (!cached.isFresh && await acquireRefreshLease(cached.listingId)) {
        refreshing = await scheduleBackgroundRefresh(refreshCachedAnalysis(normalizedTicker, cached.listingId));
        if (!refreshing) await recordRefreshFailure(cached.listingId, "Background refresh is unavailable in this runtime");
      }
      await recordCompanyView(normalizedTicker, cached.listingId);
      if (cached.isFresh) {
        await scheduleBackgroundRefresh(refreshDueCompanies(1, normalizedTicker));
      }
      return NextResponse.json({
        data: markSnapshotFreshness(cached.analysis, cached.isFresh ? "cached" : refreshing ? "refreshing" : "stale"),
        meta: {
          ticker: normalizedTicker,
          cache: cached.isFresh ? "hit" : "stale",
          cached_at: cached.generatedAt,
          fresh_until: cached.freshUntil,
          refreshing,
        },
      });
    }

    const analysis = await rebuildAnalysisFromComponentCaches(normalizedTicker);
    const persisted = await readCachedAnalysis(normalizedTicker);
    return NextResponse.json({
      data: analysis,
      meta: { ticker: normalizedTicker, cache: forceRefresh ? "refresh" : "miss", cached: Boolean(persisted) },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Analysis failed" },
      { status: 422 },
    );
  }
}
