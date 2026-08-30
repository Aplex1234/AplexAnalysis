import { NextResponse } from "next/server";
import type { Assumptions } from "@/lib/server/analysis";
import { rebuildAnalysisFromComponentCaches } from "@/lib/server/analysis-service";
import { normalizeTicker } from "@/lib/server/security-master";

const MAX_BODY_BYTES = 8_192;

async function readBoundedJson(request: Request) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("Valuation request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function optionalFiniteNumber(value: unknown, minimum: number, maximum: number) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Valuation input must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function parseAssumptions(value: unknown): Partial<Assumptions> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid valuation assumptions.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["forecast_years", "revenue_growth", "fcf_margin", "wacc", "terminal_growth"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Unknown valuation assumption.");
  const forecastYears = optionalFiniteNumber(input.forecast_years, 1, 10);
  if (forecastYears != null && !Number.isInteger(forecastYears)) throw new Error("Forecast years must be a whole number.");
  return {
    ...(forecastYears == null ? {} : { forecast_years: forecastYears }),
    ...(input.revenue_growth === undefined ? {} : { revenue_growth: optionalFiniteNumber(input.revenue_growth, -0.5, 1) }),
    ...(input.fcf_margin === undefined ? {} : { fcf_margin: optionalFiniteNumber(input.fcf_margin, -0.5, 1) }),
    ...(input.wacc === undefined ? {} : { wacc: optionalFiniteNumber(input.wacc, 0.01, 0.5) as number }),
    ...(input.terminal_growth === undefined ? {} : { terminal_growth: optionalFiniteNumber(input.terminal_growth, -0.05, 0.1) as number }),
  };
}

export async function POST(request: Request, context: { params: Promise<{ ticker: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ detail: "Valuation request is too large." }, { status: 413 });
  }
  try {
    const { ticker } = await context.params;
    const normalizedTicker = normalizeTicker(ticker);
    const parsedPayload = await readBoundedJson(request);
    if (typeof parsedPayload !== "object" || parsedPayload == null || Array.isArray(parsedPayload)) {
      throw new Error("Invalid valuation request.");
    }
    const payload = parsedPayload as { assumptions?: unknown };
    const assumptions = parseAssumptions(payload.assumptions);
    return NextResponse.json({
      data: await rebuildAnalysisFromComponentCaches(normalizedTicker, assumptions, false),
      meta: { ticker: normalizedTicker, custom_assumptions: true },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ detail: error.message }, { status: 413 });
    }
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Valuation failed" },
      { status: 422 },
    );
  }
}
