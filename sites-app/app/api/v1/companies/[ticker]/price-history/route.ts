import { NextResponse } from "next/server";
import { getStockPriceHistory, type PriceHistoryRange } from "@/lib/server/market-data";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const requestStartedAt = Date.now();
  try {
    const { ticker } = await context.params;
    const requestedRange = new URL(request.url).searchParams.get("range");
    const range: PriceHistoryRange = requestedRange === "1d" || requestedRange === "5y" || requestedRange === "max" ? requestedRange : "1y";
    const data = await getStockPriceHistory(ticker, range);
    const etag = `W/"price-history-${data.ticker}-${data.range}-${data.as_of}"`;
    const headers = {
      "Cache-Control": range === "1d"
        ? "public, max-age=15, s-maxage=60, stale-while-revalidate=120"
        : "public, max-age=300, s-maxage=3600, stale-while-revalidate=21600",
      ETag: etag,
      "Server-Timing": `app;dur=${Date.now() - requestStartedAt}`,
    };
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Price history failed" },
      { status: 422 },
    );
  }
}
