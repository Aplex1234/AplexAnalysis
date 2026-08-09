import { NextResponse } from "next/server";
import { getStockPriceHistory, type PriceHistoryRange } from "@/lib/server/market-data";

export async function GET(request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    const requestedRange = new URL(request.url).searchParams.get("range");
    const range: PriceHistoryRange = requestedRange === "5y" || requestedRange === "max" ? requestedRange : "1y";
    return NextResponse.json({ data: await getStockPriceHistory(ticker, range) });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Price history failed" },
      { status: 422 },
    );
  }
}
