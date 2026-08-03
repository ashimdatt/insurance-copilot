import { NextResponse } from "next/server";
import { createCase, listCases } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ cases: listCases() });
}

export async function POST() {
  const caseRecord = createCase();
  return NextResponse.json({ case: caseRecord }, { status: 201 });
}
