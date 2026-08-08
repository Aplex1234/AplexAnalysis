import { NextResponse } from "next/server";
import { getStockPriceHistory } from "@/lib/server/market-data";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    return NextResponse.json({ data: await getStockPriceHistory(ticker) });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Price history failed" },
      { status: 422 },
    );
  }
}
