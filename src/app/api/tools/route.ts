import { NextResponse } from "next/server";
import { getCase } from "@/lib/db";
import {
  mergeFields,
  runPostIntakeAnalysis,
  verifyIdentity,
} from "@/lib/orchestrator";
import type { ExtractedFields } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Tool-call bridge for the OpenAI Realtime voice agent.
 * The browser forwards function calls here so PII matching and
 * analysis stay on our server.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    caseId?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };

  if (!body.caseId || !body.name) {
    return NextResponse.json(
      { error: "caseId and name are required" },
      { status: 400 },
    );
  }
  if (!getCase(body.caseId)) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const args = body.arguments ?? {};

  switch (body.name) {
    case "update_case_fields": {
      const { transcriptChunk, ...fields } = args as ExtractedFields & {
        transcriptChunk?: string;
      };
      const updated = mergeFields(body.caseId, fields, transcriptChunk);
      return NextResponse.json({
        ok: true,
        message: "Fields saved",
        case: updated,
      });
    }
    case "verify_identity": {
      const name = String(args.name ?? "");
      const dateOfBirth = String(args.dateOfBirth ?? "");
      const result = verifyIdentity(body.caseId, name, dateOfBirth);
      return NextResponse.json(result);
    }
    case "complete_intake": {
      if (args.finalSummary) {
        mergeFields(body.caseId, {}, String(args.finalSummary));
      }
      const escalate = Boolean(args.escalate);
      if (escalate) {
        mergeFields(body.caseId, {});
        const { updateCase } = await import("@/lib/db");
        const { appendAudit } = await import("@/lib/audit");
        updateCase(body.caseId, { flagged: true });
        appendAudit(body.caseId, "voice_agent", "escalated", {
          reason: args.finalSummary ?? "escalate flag",
        });
      }
      const { getIntakeClosing } = await import("@/lib/orchestrator");
      const closing = getIntakeClosing(body.caseId, escalate);
      const analyzed = await runPostIntakeAnalysis(body.caseId);
      const { appendAudit } = await import("@/lib/audit");
      appendAudit(body.caseId, "voice_agent", "intake_closing_spoken", {
        suggestedClosing: closing.suggestedClosing,
        notificationPhone: closing.notificationPhone,
      });
      return NextResponse.json({
        ok: true,
        message:
          "Intake complete. Speak suggestedClosing to the caller, then end the call.",
        suggestedClosing: closing.suggestedClosing,
        notificationPhone: closing.notificationPhone,
        notificationPhoneDisplay: closing.notificationPhoneDisplay,
        notificationPhoneSpeech: closing.notificationPhoneSpeech,
        case: analyzed,
      });
    }
    default:
      return NextResponse.json(
        { error: `Unknown tool: ${body.name}` },
        { status: 400 },
      );
  }
}
