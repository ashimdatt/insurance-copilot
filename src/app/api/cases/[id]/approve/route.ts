import { NextResponse } from "next/server";
import { getCase } from "@/lib/db";
import { approveCase } from "@/lib/orchestrator";
import type { CoverageDecision, NbaResult } from "@/lib/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!getCase(id)) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    acceptSuggestion?: boolean;
    humanDecision?: CoverageDecision;
    humanNotes?: string;
    overrideNba?: NbaResult;
  };

  try {
    const updated = approveCase(id, {
      acceptSuggestion: body.acceptSuggestion ?? true,
      humanDecision: body.humanDecision,
      humanNotes: body.humanNotes,
      overrideNbaAction: body.overrideNba,
    });
    return NextResponse.json({ case: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Approval failed",
      },
      { status: 500 },
    );
  }
}
