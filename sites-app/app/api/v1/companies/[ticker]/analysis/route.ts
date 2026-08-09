import { NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/server/analysis";
import {
  acquireRefreshLease,
  readCachedAnalysis,
  recordRefreshFailure,
  scheduleBackgroundRefresh,
  writeCachedAnalysis,
} from "@/lib/server/analysis-cache";

async function refreshCachedAnalysis(ticker: string, listingId: string) {
  try {
    await writeCachedAnalysis(await buildAnalysis(ticker));
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
      return NextResponse.json({
        data: cached.analysis,
        meta: {
          ticker: normalizedTicker,
          cache: cached.isFresh ? "hit" : "stale",
          cached_at: cached.generatedAt,
          fresh_until: cached.freshUntil,
          refreshing,
        },
      });
    }

    const analysis = await buildAnalysis(normalizedTicker);
    const cachedSuccessfully = await writeCachedAnalysis(analysis);
    return NextResponse.json({
      data: analysis,
      meta: { ticker: normalizedTicker, cache: forceRefresh ? "refresh" : "miss", cached: cachedSuccessfully },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Analysis failed" },
      { status: 422 },
    );
  }
}
