export const VOICE_AGENT_INSTRUCTIONS = `
You are a calm roadside assistance intake agent for an insurance co-pilot demo.
Your only job is to collect and confirm facts for a stranded driver. You never discuss coverage, never promise help will be approved, and never quote policy language.

Collect, in natural conversation (order can vary):
1. Full name
2. Date of birth (for policyholder verification) in YYYY-MM-DD when storing
3. Vehicle make, model, year, and plate if offered
4. Location: prefer that they share GPS via the on-screen button; if they speak an address, capture locationText
5. What happened / damage type: flat_tire, dead_battery, lockout, out_of_fuel, mechanical, collision, or other
6. Short situation description

Rules:
- Be brief, warm, and clear. The caller may be stressed.
- Allow barge-in and out-of-order answers.
- Call tools as soon as you have usable values.
- After identity fields are known, call verify_identity.
- When intake looks complete, read every captured field back and ask for confirmation.
- Only after the caller confirms, call complete_intake.
- If the caller reports injuries, an active emergency, or danger, say you will escalate to a human and call complete_intake with escalate=true.
- Hard stop: do not talk about whether something is covered.

Demo policyholders you can use if the user asks for a test identity:
- Jordan Lee, DOB 1988-04-12
- Sam Rivera, DOB 1992-11-03
- Alex Chen, DOB 1975-07-22
- Morgan Patel, DOB 1990-01-15
`.trim();

export const REALTIME_TOOLS = [
  {
    type: "function",
    name: "update_case_fields",
    description:
      "Save or update structured intake fields extracted from the conversation.",
    parameters: {
      type: "object",
      properties: {
        policyholderName: { type: "string" },
        dateOfBirth: {
          type: "string",
          description: "ISO date YYYY-MM-DD",
        },
        vehicleMake: { type: "string" },
        vehicleModel: { type: "string" },
        vehicleYear: { type: "string" },
        plate: { type: "string" },
        locationText: { type: "string" },
        locationLat: { type: "number" },
        locationLng: { type: "number" },
        damageType: {
          type: "string",
          enum: [
            "flat_tire",
            "dead_battery",
            "lockout",
            "out_of_fuel",
            "mechanical",
            "collision",
            "other",
          ],
        },
        damageDescription: { type: "string" },
        situation: { type: "string" },
        transcriptChunk: {
          type: "string",
          description: "Latest relevant utterance(s) to append to the transcript",
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "verify_identity",
    description:
      "Verify the caller against the policy database using name and date of birth.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        dateOfBirth: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["name", "dateOfBirth"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "complete_intake",
    description:
      "End intake after read-back confirmation. Triggers post-call coverage analysis for the human agent dashboard.",
    parameters: {
      type: "object",
      properties: {
        escalate: {
          type: "boolean",
          description: "True if the case should be flagged for immediate human help",
        },
        finalSummary: { type: "string" },
      },
      additionalProperties: false,
    },
  },
] as const;
