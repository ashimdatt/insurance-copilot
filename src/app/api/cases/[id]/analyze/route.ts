import { NextResponse } from "next/server";
import { appendAudit } from "@/lib/audit";
import { getCase, updateCase } from "@/lib/db";
import {
  getIntakeClosing,
  mergeFields,
  runPostIntakeAnalysis,
} from "@/lib/orchestrator";

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
    mergeFields(id, {}, body.finalSummary);
  }
  const escalate = Boolean(body.escalate);
  if (escalate) {
    updateCase(id, { flagged: true });
    appendAudit(id, "voice_agent", "escalated", {
      reason: body.finalSummary ?? "Caller requested or safety escalate",
    });
  }

  const closing = getIntakeClosing(id, escalate);
  const analyzed = await runPostIntakeAnalysis(id);
  appendAudit(id, "voice_agent", "intake_closing_spoken", {
    suggestedClosing: closing.suggestedClosing,
    notificationPhone: closing.notificationPhone,
    channel: "analyze_api",
  });

  return NextResponse.json({
    case: analyzed,
    suggestedClosing: closing.suggestedClosing,
    notificationPhone: closing.notificationPhone,
    notificationPhoneDisplay: closing.notificationPhoneDisplay,
  });
}
