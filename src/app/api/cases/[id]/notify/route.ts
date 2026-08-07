import { NextResponse } from "next/server";
import { getCase } from "@/lib/db";
import { sendCaseSms } from "@/lib/orchestrator";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!getCase(id)) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    agentId?: string;
  };

  try {
    const updated = sendCaseSms(id, {
      message: body.message,
      agentId: body.agentId,
    });
    return NextResponse.json({ case: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send SMS",
      },
      { status: 400 },
    );
  }
}
