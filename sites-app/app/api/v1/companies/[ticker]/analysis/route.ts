import { NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/server/analysis";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    return NextResponse.json({ data: await buildAnalysis(ticker), meta: { ticker: ticker.toUpperCase() } });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Analysis failed" },
      { status: 422 },
    );
  }
}

