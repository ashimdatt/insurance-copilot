import { NextResponse } from "next/server";
import { appendAudit, getCase, updateCase } from "@/lib/db";
import { runPostIntakeAnalysis } from "@/lib/orchestrator";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const existing = getCase(id);
  if (!existing) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    escalate?: boolean;
    finalSummary?: string;
  };

  if (body.finalSummary) {
    updateCase(id, {
      transcript: `${existing.transcript}\n${body.finalSummary}`.trim(),
    });
  }
  if (body.escalate) {
    updateCase(id, { flagged: true });
    appendAudit(id, "voice_agent", "escalated", {
      reason: body.finalSummary ?? "Caller requested or safety escalate",
    });
  }

  const analyzed = await runPostIntakeAnalysis(id);
  return NextResponse.json({ case: analyzed });
}
