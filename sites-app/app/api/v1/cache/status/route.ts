import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { detail: "Not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
