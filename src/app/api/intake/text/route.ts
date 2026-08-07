import { NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getCase } from "@/lib/db";
import { mergeFields, verifyIdentity } from "@/lib/orchestrator";
import type { DamageType, ExtractedFields } from "@/lib/types";

export const runtime = "nodejs";

const ExtractSchema = z.object({
  fields: z.object({
    policyholderName: z.string().optional(),
    dateOfBirth: z.string().optional(),
    vehicleMake: z.string().optional(),
    vehicleModel: z.string().optional(),
    vehicleYear: z.string().optional(),
    plate: z.string().optional(),
    locationText: z.string().optional(),
    damageType: z
      .enum([
        "flat_tire",
        "dead_battery",
        "lockout",
        "out_of_fuel",
        "mechanical",
        "collision",
        "other",
      ])
      .optional(),
    damageDescription: z.string().optional(),
    situation: z.string().optional(),
  }),
  shouldVerify: z.boolean(),
  assistantMessage: z.string(),
});

export async function POST(request: Request) {
  const body = (await request.json()) as {
    caseId?: string;
    message?: string;
  };
  if (!body.caseId || !body.message?.trim()) {
    return NextResponse.json(
      { error: "caseId and message are required" },
      { status: 400 },
    );
  }
  const existing = getCase(body.caseId);
  if (!existing) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const prompt = `You are a roadside intake agent. Extract any new fields from the user message and reply briefly.
Never discuss coverage or promise approval.
Current fields: ${JSON.stringify(existing.fields)}
User message: """${body.message}"""

Return JSON only:
{"fields":{...partial fields...},"shouldVerify":true|false,"assistantMessage":"..."}
Use YYYY-MM-DD for dateOfBirth when possible.
damageType one of: flat_tire, dead_battery, lockout, out_of_fuel, mechanical, collision, other.
Set shouldVerify true when both name and DOB are known (existing or newly extracted).`;

  let parsed: z.infer<typeof ExtractSchema>;
  try {
    parsed = ExtractSchema.parse(JSON.parse(await runExtract(prompt)));
  } catch (error) {
    console.error(error);
    // Deterministic fallback for offline/demo without keys
    parsed = heuristicExtract(body.message, existing.fields);
  }

  const updated = mergeFields(
    body.caseId,
    parsed.fields as ExtractedFields,
    `Caller: ${body.message}\nAgent: ${parsed.assistantMessage}`,
  );

  let verifyResult = null;
  const name =
    parsed.fields.policyholderName || updated?.fields.policyholderName;
  const dob = parsed.fields.dateOfBirth || updated?.fields.dateOfBirth;
  if (parsed.shouldVerify && name && dob) {
    verifyResult = verifyIdentity(body.caseId, name, dob);
  }

  const latest = getCase(body.caseId);
  return NextResponse.json({
    case: latest,
    assistantMessage: parsed.assistantMessage,
    verifyResult,
  });
}

async function runExtract(prompt: string): Promise<string> {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });
    return message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .match(/\{[\s\S]*\}/)?.[0] ?? "{}";
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("No LLM API key configured");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return valid JSON only." },
      { role: "user", content: prompt },
    ],
  });
  return completion.choices[0]?.message?.content ?? "{}";
}

function heuristicExtract(
  message: string,
  current: ExtractedFields,
): z.infer<typeof ExtractSchema> {
  const fields: ExtractedFields = {};
  const lower = message.toLowerCase();

  const demos: Array<{ name: string; dob: string }> = [
    { name: "Jordan Lee", dob: "1988-04-12" },
    { name: "Sam Rivera", dob: "1992-11-03" },
    { name: "Alex Chen", dob: "1975-07-22" },
    { name: "Morgan Patel", dob: "1990-01-15" },
    { name: "Ashim Datta", dob: "1965-03-07" },
  ];
  for (const demo of demos) {
    if (lower.includes(demo.name.toLowerCase())) {
      fields.policyholderName = demo.name;
      fields.dateOfBirth = demo.dob;
    }
  }

  const dobMatch = message.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
  if (dobMatch) fields.dateOfBirth = dobMatch[0];

  const damageMap: Array<[string, DamageType]> = [
    ["flat tire", "flat_tire"],
    ["flat_tire", "flat_tire"],
    ["dead battery", "dead_battery"],
    ["battery", "dead_battery"],
    ["lockout", "lockout"],
    ["locked out", "lockout"],
    ["out of fuel", "out_of_fuel"],
    ["no gas", "out_of_fuel"],
    ["out of charge", "out_of_fuel"],
    ["no charge", "out_of_fuel"],
    ["depleted", "out_of_fuel"],
    ["ran out of range", "out_of_fuel"],
    ["zero percent", "out_of_fuel"],
    ["0%", "out_of_fuel"],
    ["collision", "collision"],
    ["accident", "collision"],
    ["won't start", "mechanical"],
    ["mechanical", "mechanical"],
  ];
  for (const [needle, value] of damageMap) {
    if (lower.includes(needle)) {
      fields.damageType = value;
      break;
    }
  }

  if (/toyota|honda|ford|tesla/i.test(message)) {
    const make = message.match(/\b(Toyota|Honda|Ford|Tesla)\b/i);
    if (make) fields.vehicleMake = make[1];
  }
  if (/camry|cr-?v|f-?150|model\s*[3y]/i.test(message)) {
    const model = message.match(/\b(Camry|CR-?V|F-?150|Model\s*[3Y])\b/i);
    if (model) fields.vehicleModel = model[1];
  }

  fields.situation = message;
  const merged = { ...current, ...fields };
  const shouldVerify = Boolean(
    merged.policyholderName && merged.dateOfBirth,
  );

  return {
    fields,
    shouldVerify,
    assistantMessage: shouldVerify
      ? "Thanks, I have your identity details. Tell me about the vehicle and what happened if you have not already, then we can confirm everything."
      : "Got it. Please share your full name and date of birth so I can find your policy, plus what happened and where you are.",
  };
}
