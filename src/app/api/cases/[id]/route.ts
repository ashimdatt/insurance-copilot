import { NextResponse } from "next/server";
import { getCase, listAudit, updateCase } from "@/lib/db";
import { mergeFields } from "@/lib/orchestrator";
import type { ExtractedFields } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const caseRecord = getCase(id);
  if (!caseRecord) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  return NextResponse.json({
    case: caseRecord,
    audit: listAudit(id),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as {
    fields?: ExtractedFields;
    transcript?: string;
    transcriptChunk?: string;
    flagged?: boolean;
  };

  if (body.fields || body.transcriptChunk) {
    const updated = mergeFields(id, body.fields ?? {}, body.transcriptChunk);
    if (!updated) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }
    if (body.transcript) {
      return NextResponse.json({
        case: updateCase(id, { transcript: body.transcript }),
      });
    }
    return NextResponse.json({ case: updated });
  }

  const updated = updateCase(id, {
    transcript: body.transcript,
    flagged: body.flagged,
  });
  if (!updated) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  return NextResponse.json({ case: updated });
}
