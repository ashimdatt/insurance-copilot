import { NextResponse } from "next/server";
import { getCase } from "@/lib/db";
import { verifyIdentity } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    caseId?: string;
    name?: string;
    dateOfBirth?: string;
  };

  if (!body.caseId || !body.name || !body.dateOfBirth) {
    return NextResponse.json(
      { error: "caseId, name, and dateOfBirth are required" },
      { status: 400 },
    );
  }
  if (!getCase(body.caseId)) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const result = verifyIdentity(body.caseId, body.name, body.dateOfBirth);
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
