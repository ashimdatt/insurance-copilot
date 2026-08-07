import { NextResponse } from "next/server";
import { getCase } from "@/lib/db";
import { listAudit, verifyAuditChain } from "@/lib/audit";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!getCase(id)) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const audit = listAudit(id);
  const verification = verifyAuditChain(id);
  return NextResponse.json({
    caseId: id,
    verification,
    audit,
  });
}
