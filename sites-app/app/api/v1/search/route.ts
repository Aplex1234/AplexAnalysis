import { NextResponse } from "next/server";
import { searchSecurities } from "@/lib/server/security-master";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number(searchParams.get("limit") ?? 8);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 20)) : 8;

  if (!query || query.length > 80) {
    return NextResponse.json(
      { detail: "Search query must contain between 1 and 80 characters." },
      { status: 422 },
    );
  }

  return NextResponse.json(await searchSecurities(query, limit));
}
