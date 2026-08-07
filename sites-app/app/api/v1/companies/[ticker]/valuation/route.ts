import { NextResponse } from "next/server";
import { buildAnalysis, type Assumptions } from "@/lib/server/analysis";

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    const { ticker } = await context.params;
    const payload = (await request.json()) as { assumptions?: Partial<Assumptions> };
    return NextResponse.json({
      data: await buildAnalysis(ticker, payload.assumptions),
      meta: { ticker: ticker.toUpperCase(), custom_assumptions: true },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Valuation failed" },
      { status: 422 },
    );
  }
}

