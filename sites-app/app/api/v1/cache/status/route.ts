import { NextResponse } from "next/server";
import { getCacheMonitoringSummary } from "@/lib/server/analysis-cache";

export async function GET() {
  try {
    return NextResponse.json({ data: await getCacheMonitoringSummary() });
  } catch {
    return NextResponse.json({ data: { available: false, events: [], cachedCompanies: 0, lastSuccessfulRefresh: null } });
  }
}
