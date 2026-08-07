import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { getClausesForPolicy } from "./db";
import type {
  CoverageCheckTrace,
  CoverageDecision,
  CoverageResult,
  DamageType,
  ExtractedFields,
  PolicyClause,
} from "./types";

const CoverageSchema = z.object({
  decision: z.enum(["covered", "not_covered", "uncertain"]),
  confidence: z.number().min(0).max(1),
  clauseId: z.string().nullable(),
  rationale: z.string(),
});

function retrieveRelevantClauses(
  policyId: string,
  damageType?: DamageType,
): PolicyClause[] {
  const clauses = getClausesForPolicy(policyId);
  if (!damageType) return clauses;
  const matched = clauses.filter((c) => c.covers.includes(damageType));
  return matched.length > 0 ? matched : clauses;
}

function ruleBasedCoverage(
  fields: ExtractedFields,
  clauses: PolicyClause[],
): CoverageResult {
  const damageType = fields.damageType;
  if (!damageType) {
    return {
      decision: "uncertain",
      confidence: 0.2,
      clauseId: null,
      clauseText: null,
      rationale: "Damage type missing; escalate to human.",
    };
  }

  if (damageType === "collision") {
    const clause = clauses.find((c) => c.covers.includes("collision"));
    return {
      decision: "uncertain",
      confidence: 0.4,
      clauseId: clause?.id ?? null,
      clauseText: clause
        ? `${clause.section} ${clause.title}: ${clause.text}`
        : null,
      rationale:
        "Collision-related roadside cases require human review per policy exclusions.",
    };
  }

  const clause = clauses.find((c) => c.covers.includes(damageType));
  if (!clause) {
    return {
      decision: "uncertain",
      confidence: 0.35,
      clauseId: null,
      clauseText: null,
      rationale: `No clause matched damage type "${damageType}".`,
    };
  }

  return {
    decision: "covered",
    confidence: 0.78,
    clauseId: clause.id,
    clauseText: `${clause.section} ${clause.title}: ${clause.text}`,
    rationale: `Matched clause ${clause.id} for damage type ${damageType}.`,
  };
}

function buildCoveragePrompt(
  redactedTranscript: string,
  fields: ExtractedFields,
  clauses: PolicyClause[],
): string {
  const clauseBlock = clauses
    .map(
      (c) =>
        `- ${c.id} | §${c.section} ${c.title}\n  ${c.text}\n  covers: ${c.covers.join(", ")}`,
    )
    .join("\n");

  return `You are an insurance coverage analyst for roadside assistance.
Decide covered / not_covered / uncertain for this case.
You MUST cite a clause id from the list. If no clause applies, decision must be uncertain and clauseId null.
Never invent clause ids. Personal data is already redacted.

Extracted fields (may be partial, PII removed):
${JSON.stringify(
  {
    ...fields,
    policyholderName: fields.policyholderName ? "[NAME]" : undefined,
    dateOfBirth: fields.dateOfBirth ? "[DOB]" : undefined,
    plate: fields.plate ? "[PLATE]" : undefined,
  },
  null,
  2,
)}

Redacted transcript:
"""
${redactedTranscript || "(empty)"}
"""

Policy clauses:
${clauseBlock}

Respond with JSON only:
{"decision":"covered"|"not_covered"|"uncertain","confidence":0-1,"clauseId":"CL-xxx"|null,"rationale":"..."}`;
}

async function llmCoverage(
  prompt: string,
  clauses: PolicyClause[],
): Promise<{
  result: CoverageResult;
  provider: string;
  model: string;
  rawResponse: string;
} | null> {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();

  try {
    if (provider === "anthropic") {
      if (!process.env.ANTHROPIC_API_KEY) return null;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const model =
        process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
      const message = await client.messages.create({
        model,
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return {
        result: parseCoverageResponse(text, clauses),
        provider: "anthropic",
        model,
        rawResponse: text,
      };
    }

    if (!process.env.OPENAI_API_KEY) return null;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You output valid JSON only for roadside coverage decisions.",
        },
        { role: "user", content: prompt },
      ],
    });
    const text = completion.choices[0]?.message?.content ?? "";
    return {
      result: parseCoverageResponse(text, clauses),
      provider: "openai",
      model,
      rawResponse: text,
    };
  } catch (error) {
    console.error("Coverage LLM failed, falling back to rules:", error);
    return null;
  }
}

function parseCoverageResponse(
  text: string,
  clauses: PolicyClause[],
): CoverageResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON in model response");
  }
  const parsed = CoverageSchema.parse(JSON.parse(jsonMatch[0]));
  const clause = parsed.clauseId
    ? clauses.find((c) => c.id === parsed.clauseId)
    : null;

  let decision: CoverageDecision = parsed.decision;
  if (!clause && parsed.decision !== "uncertain") {
    decision = "uncertain";
  }

  return {
    decision,
    confidence: parsed.confidence,
    clauseId: clause?.id ?? null,
    clauseText: clause
      ? `${clause.section} ${clause.title}: ${clause.text}`
      : null,
    rationale: clause
      ? parsed.rationale
      : `${parsed.rationale} (escalated: missing or invalid citation)`,
  };
}

export async function checkCoverage(input: {
  policyId: string;
  fields: ExtractedFields;
  redactedTranscript: string;
}): Promise<CoverageCheckTrace> {
  const clauses = retrieveRelevantClauses(
    input.policyId,
    input.fields.damageType,
  );
  const prompt = buildCoveragePrompt(
    input.redactedTranscript,
    input.fields,
    clauses,
  );
  const llm = await llmCoverage(prompt, clauses);
  const retrievedClauses = clauses.map((c) => ({
    id: c.id,
    section: c.section,
    title: c.title,
  }));
  const retrievedClauseIds = clauses.map((c) => c.id);

  if (llm) {
    return {
      result: llm.result,
      method: "llm",
      provider: llm.provider,
      model: llm.model,
      policyId: input.policyId,
      retrievedClauseIds,
      retrievedClauses,
      prompt,
      rawResponse: llm.rawResponse,
    };
  }

  return {
    result: ruleBasedCoverage(input.fields, clauses),
    method: "rules",
    provider: null,
    model: null,
    policyId: input.policyId,
    retrievedClauseIds,
    retrievedClauses,
    prompt,
    rawResponse: null,
  };
}
