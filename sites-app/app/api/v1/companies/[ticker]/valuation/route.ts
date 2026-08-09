import { NextResponse } from "next/server";
import type { Assumptions } from "@/lib/server/analysis";
import { rebuildAnalysisFromComponentCaches } from "@/lib/server/analysis-service";

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    const payload = (await request.json()) as { assumptions?: Partial<Assumptions> };
    return NextResponse.json({
      data: await rebuildAnalysisFromComponentCaches(ticker, payload.assumptions, false),
      meta: { ticker: ticker.toUpperCase(), custom_assumptions: true },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Valuation failed" },
      { status: 422 },
    );
  }
}
