import {
  appendAudit,
  findPolicyholderByIdentity,
  getCase,
  updateCase,
} from "./db";
import { checkCoverage } from "./coverage";
import { recommendDispatch } from "./garage";
import { redactTranscript } from "./redact";
import type { CaseRecord, ExtractedFields } from "./types";

export function verifyIdentity(
  caseId: string,
  name: string,
  dateOfBirth: string,
): { ok: boolean; case: CaseRecord | null; message: string } {
  const existing = getCase(caseId);
  if (!existing) {
    return { ok: false, case: null, message: "Case not found" };
  }

  const match = findPolicyholderByIdentity(name, dateOfBirth);
  if (!match) {
    appendAudit(caseId, "system", "identity_failed", { name, dateOfBirth });
    const updated = updateCase(caseId, {
      fields: { ...existing.fields, policyholderName: name, dateOfBirth },
      identityVerified: false,
      flagged: true,
    });
    return {
      ok: false,
      case: updated,
      message:
        "No policyholder matched name + DOB. Case flagged for human review.",
    };
  }

  const updated = updateCase(caseId, {
    fields: {
      ...existing.fields,
      policyholderName: match.name,
      dateOfBirth: match.dateOfBirth,
      vehicleMake: existing.fields.vehicleMake || match.vehicleMake,
      vehicleModel: existing.fields.vehicleModel || match.vehicleModel,
      vehicleYear: existing.fields.vehicleYear || match.vehicleYear,
      plate: existing.fields.plate || match.plate,
    },
    identityVerified: true,
    policyholderId: match.id,
    policyId: match.policyId,
  });
  appendAudit(caseId, "system", "identity_verified", {
    policyholderId: match.id,
    policyId: match.policyId,
  });
  return { ok: true, case: updated, message: `Verified ${match.name}` };
}

export async function runPostIntakeAnalysis(
  caseId: string,
): Promise<CaseRecord> {
  const existing = getCase(caseId);
  if (!existing) {
    throw new Error(`Case ${caseId} not found`);
  }

  const redacted = redactTranscript(existing.transcript, existing.fields);
  let policyId = existing.policyId;

  if (!existing.identityVerified || !policyId) {
    const flagged = updateCase(caseId, {
      status: "pending_review",
      redactedTranscript: redacted,
      flagged: true,
      coverage: {
        decision: "uncertain",
        confidence: 0,
        clauseId: null,
        clauseText: null,
        rationale: "Identity not verified; coverage check blocked.",
      },
      nba: recommendDispatch(existing.fields),
    });
    appendAudit(caseId, "system", "analysis_blocked_unverified", {});
    return flagged!;
  }

  const coverage = await checkCoverage({
    policyId,
    fields: existing.fields,
    redactedTranscript: redacted,
  });
  const nba = recommendDispatch(existing.fields);
  const flagged =
    coverage.decision !== "covered" ||
    coverage.confidence < 0.7 ||
    !coverage.clauseId;

  const updated = updateCase(caseId, {
    status: "pending_review",
    redactedTranscript: redacted,
    coverage,
    nba,
    flagged,
  });
  appendAudit(caseId, "system", "analysis_complete", {
    coverage,
    nba,
    flagged,
  });
  return updated!;
}

export function mergeFields(
  caseId: string,
  fields: ExtractedFields,
  transcriptChunk?: string,
): CaseRecord | null {
  const existing = getCase(caseId);
  if (!existing) return null;
  const transcript = transcriptChunk
    ? `${existing.transcript}\n${transcriptChunk}`.trim()
    : existing.transcript;
  const updated = updateCase(caseId, {
    fields: { ...existing.fields, ...fields },
    transcript,
    redactedTranscript: redactTranscript(transcript, {
      ...existing.fields,
      ...fields,
    }),
  });
  appendAudit(caseId, "voice_agent", "fields_updated", { fields });
  return updated;
}

export function buildSmsPreview(caseRecord: CaseRecord): string {
  const decision =
    caseRecord.humanDecision ?? caseRecord.coverage?.decision ?? "uncertain";
  const action = caseRecord.nba?.action ?? "none";
  const garage = caseRecord.nba?.garageName;
  const name = caseRecord.fields.policyholderName ?? "there";

  if (decision === "covered") {
    return `Hi ${name}, your roadside request is approved (${decision}). Next step: ${action}${
      garage ? ` via ${garage}` : ""
    }. A dispatcher will follow up shortly.`;
  }
  if (decision === "not_covered") {
    return `Hi ${name}, after review we cannot cover this request under your roadside benefit. An agent can explain options if you reply to this message.`;
  }
  return `Hi ${name}, we need a bit more review on your roadside request. An agent will contact you shortly with next steps.`;
}

export function approveCase(
  caseId: string,
  input: {
    acceptSuggestion: boolean;
    humanDecision?: CaseRecord["humanDecision"];
    humanNotes?: string;
    overrideNbaAction?: CaseRecord["nba"];
  },
): CaseRecord {
  const existing = getCase(caseId);
  if (!existing) throw new Error(`Case ${caseId} not found`);

  const humanDecision = input.acceptSuggestion
    ? existing.coverage?.decision ?? "uncertain"
    : input.humanDecision ?? "uncertain";

  const nba = input.overrideNbaAction ?? existing.nba;
  const status = input.acceptSuggestion ? "approved" : "overridden";
  const withDecision = updateCase(caseId, {
    status,
    humanDecision,
    humanNotes: input.humanNotes ?? null,
    nba,
  });
  appendAudit(caseId, "human_agent", status, {
    humanDecision,
    notes: input.humanNotes ?? null,
  });

  const smsPreview = buildSmsPreview(withDecision!);
  const notified = updateCase(caseId, {
    status: "notified",
    smsPreview,
  });
  appendAudit(caseId, "system", "sms_simulated", { smsPreview });
  return notified!;
}
