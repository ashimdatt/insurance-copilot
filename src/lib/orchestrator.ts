import { appendAudit } from "./audit";
import { findPolicyholderByIdentity, getCase, getPolicyholder, updateCase } from "./db";
import { checkCoverage } from "./coverage";
import { recommendDispatch } from "./garage";
import {
  buildIntakeClosingScript,
  formatPhoneDisplay,
  formatPhoneForSpeech,
} from "./phone";
import { redactTranscript } from "./redact";
import type { CaseRecord, ExtractedFields } from "./types";

export function verifyIdentity(
  caseId: string,
  name: string,
  dateOfBirth: string,
): {
  ok: boolean;
  case: CaseRecord | null;
  message: string;
  notificationPhone?: string;
  notificationPhoneDisplay?: string;
  notificationPhoneSpeech?: string;
} {
  const existing = getCase(caseId);
  if (!existing) {
    return { ok: false, case: null, message: "Case not found" };
  }

  const match = findPolicyholderByIdentity(name, dateOfBirth);
  if (!match) {
    appendAudit(caseId, "system", "identity_failed", {
      attemptedName: name,
      attemptedDob: dateOfBirth,
    });
    const updated = updateCase(caseId, {
      fields: { ...existing.fields, policyholderName: name, dateOfBirth },
      identityVerified: false,
      flagged: true,
    });
    appendAudit(caseId, "system", "case_flagged", {
      reason: "identity_mismatch",
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
      contactPhone: match.phone,
    },
    identityVerified: true,
    policyholderId: match.id,
    policyId: match.policyId,
  });
  appendAudit(caseId, "system", "identity_verified", {
    policyholderId: match.id,
    policyId: match.policyId,
    matchedName: match.name,
    notificationPhone: match.phone,
  });
  return {
    ok: true,
    case: updated,
    message: `Verified ${match.name}. Text updates will go to ${formatPhoneDisplay(match.phone)}.`,
    notificationPhone: match.phone,
    notificationPhoneDisplay: formatPhoneDisplay(match.phone),
    notificationPhoneSpeech: formatPhoneForSpeech(match.phone),
  };
}

export function resolveNotificationPhone(
  caseRecord: CaseRecord,
): string | null {
  if (caseRecord.fields.contactPhone) return caseRecord.fields.contactPhone;
  if (caseRecord.policyholderId) {
    return getPolicyholder(caseRecord.policyholderId)?.phone ?? null;
  }
  return null;
}

export function getIntakeClosing(caseId: string, escalate = false) {
  const caseRecord = getCase(caseId);
  if (!caseRecord) {
    return {
      suggestedClosing:
        "Thanks. I'm disconnecting now. We'll text next steps to the mobile on your policy within one minute.",
      notificationPhone: null as string | null,
      notificationPhoneDisplay: "",
      notificationPhoneSpeech: "the mobile number on your policy",
    };
  }
  const phone = resolveNotificationPhone(caseRecord);
  return {
    suggestedClosing: buildIntakeClosingScript({
      firstName: caseRecord.fields.policyholderName,
      phone,
      escalate,
    }),
    notificationPhone: phone,
    notificationPhoneDisplay: formatPhoneDisplay(phone),
    notificationPhoneSpeech: formatPhoneForSpeech(phone),
  };
}

export async function runPostIntakeAnalysis(
  caseId: string,
): Promise<CaseRecord> {
  const existing = getCase(caseId);
  if (!existing) {
    throw new Error(`Case ${caseId} not found`);
  }

  appendAudit(caseId, "system", "analysis_started", {
    identityVerified: existing.identityVerified,
    policyId: existing.policyId,
    damageType: existing.fields.damageType ?? null,
  });

  const redacted = redactTranscript(existing.transcript, existing.fields);
  appendAudit(caseId, "system", "pii_redaction", {
    originalLength: existing.transcript.length,
    redactedLength: redacted.length,
    redactedTranscript: redacted,
    fieldsSnapshot: existing.fields,
  });

  const policyId = existing.policyId;

  if (!existing.identityVerified || !policyId) {
    const nba = recommendDispatch(existing.fields);
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
      nba,
    });
    appendAudit(caseId, "system", "analysis_blocked_unverified", {
      nba,
    });
    appendAudit(caseId, "system", "nba_recommendation", { nba });
    return flagged!;
  }

  const trace = await checkCoverage({
    policyId,
    fields: existing.fields,
    redactedTranscript: redacted,
  });

  appendAudit(caseId, "system", "policy_retrieval", {
    policyId: trace.policyId,
    retrievedClauseIds: trace.retrievedClauseIds,
    retrievedClauses: trace.retrievedClauses,
  });

  appendAudit(caseId, "system", "coverage_model_call", {
    method: trace.method,
    provider: trace.provider,
    model: trace.model,
    prompt: trace.prompt,
    rawResponse: trace.rawResponse,
  });

  appendAudit(caseId, "system", "coverage_decision", {
    coverage: trace.result,
    method: trace.method,
  });

  const nba = recommendDispatch(existing.fields);
  appendAudit(caseId, "system", "nba_recommendation", { nba });

  const flagged =
    trace.result.decision !== "covered" ||
    trace.result.confidence < 0.7 ||
    !trace.result.clauseId;

  const updated = updateCase(caseId, {
    status: "pending_review",
    redactedTranscript: redacted,
    coverage: trace.result,
    nba,
    flagged,
  });

  appendAudit(caseId, "system", "analysis_complete", {
    coverage: trace.result,
    nba,
    flagged,
    method: trace.method,
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
  const beforeFields = { ...existing.fields };
  const transcript = transcriptChunk
    ? `${existing.transcript}\n${transcriptChunk}`.trim()
    : existing.transcript;
  const redactedTranscript = redactTranscript(transcript, {
    ...existing.fields,
    ...fields,
  });
  const updated = updateCase(caseId, {
    fields: { ...existing.fields, ...fields },
    transcript,
    redactedTranscript,
  });
  appendAudit(caseId, "voice_agent", "fields_updated", {
    before: beforeFields,
    patch: fields,
    after: updated?.fields ?? null,
  });
  if (transcriptChunk) {
    appendAudit(caseId, "voice_agent", "transcript_appended", {
      chunk: transcriptChunk,
      transcriptLength: transcript.length,
    });
  }
  return updated;
}

function humanDispatchAction(action: CaseRecord["nba"]): string {
  switch (action?.action) {
    case "tow":
      return "a flatbed tow";
    case "repair_truck":
      return "a roadside service truck";
    default:
      return "follow-up support";
  }
}

export function buildSmsPreview(caseRecord: CaseRecord): string {
  const decision =
    caseRecord.humanDecision ?? caseRecord.coverage?.decision ?? "uncertain";
  const garage = caseRecord.nba?.garageName;
  const name = caseRecord.fields.policyholderName ?? "there";
  const firstName = name.trim().split(/\s+/)[0] || name;
  const service = humanDispatchAction(caseRecord.nba);
  const notifyPhone = formatPhoneDisplay(resolveNotificationPhone(caseRecord));

  if (decision === "covered") {
    const provider = garage ? ` from ${garage}` : "";
    const phoneLine = notifyPhone
      ? ` This update is also being sent to ${notifyPhone}.`
      : "";
    return `Hi ${firstName}, good news: your roadside assistance request is approved. We're sending ${service}${provider}.${phoneLine} A dispatcher will text or call you shortly with timing and next steps.`;
  }
  if (decision === "not_covered") {
    return `Hi ${firstName}, thank you for reaching out, and we're sorry this is a stressful moment. After review, this request isn't covered under your roadside benefit as written. A human agent will follow up with you shortly to talk through other ways we may still be able to help. Please keep your phone nearby${notifyPhone ? ` (${notifyPhone})` : ""}.`;
  }
  return `Hi ${firstName}, thank you for contacting roadside assistance. We want to make sure we get this right for you, so a human agent will follow up shortly to discuss the best ways we can help. Please keep your phone nearby${notifyPhone ? ` (${notifyPhone})` : ""}.`;
}

export function approveCase(
  caseId: string,
  input: {
    acceptSuggestion: boolean;
    humanDecision?: CaseRecord["humanDecision"];
    humanNotes?: string;
    overrideNbaAction?: CaseRecord["nba"];
    agentId?: string;
  },
): CaseRecord {
  const existing = getCase(caseId);
  if (!existing) throw new Error(`Case ${caseId} not found`);

  const agentId =
    input.agentId?.trim() ||
    process.env.DEFAULT_AGENT_ID ||
    "agent-unauthenticated";

  const suggested = existing.coverage?.decision ?? "uncertain";
  const humanDecision = input.acceptSuggestion
    ? suggested
    : input.humanDecision ?? "uncertain";

  const nba = input.overrideNbaAction ?? existing.nba;
  const status = input.acceptSuggestion ? "approved" : "overridden";

  appendAudit(
    caseId,
    "human_agent",
    status,
    {
      acceptSuggestion: input.acceptSuggestion,
      suggestedDecision: suggested,
      humanDecision,
      priorCoverage: existing.coverage,
      priorNba: existing.nba,
      notes: input.humanNotes ?? null,
      overrideNba: input.overrideNbaAction ?? null,
    },
    { actorId: agentId },
  );

  const withDecision = updateCase(caseId, {
    status,
    humanDecision,
    humanNotes: input.humanNotes ?? null,
    nba,
  });

  const smsPreview = buildSmsPreview(withDecision!);
  const notified = updateCase(caseId, {
    status: "notified",
    smsPreview,
  });
  appendAudit(caseId, "system", "sms_simulated", {
    smsPreview,
    humanDecision,
    approvedBy: agentId,
  });
  return notified!;
}
