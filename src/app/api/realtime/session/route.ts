import { NextResponse } from "next/server";
import OpenAI from "openai";
import { REALTIME_TOOLS, VOICE_AGENT_INSTRUCTIONS } from "@/lib/voice";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set in .env" },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    caseId?: string;
  };
  if (!body.caseId) {
    return NextResponse.json({ error: "caseId is required" }, { status: 400 });
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

  try {
    // Current Realtime auth uses /v1/realtime/client_secrets
    // (beta /v1/realtime/sessions returns 404).
    const secret = await client.realtime.clientSecrets.create({
      expires_after: {
        anchor: "created_at",
        seconds: 600,
      },
      session: {
        type: "realtime",
        model,
        instructions: `${VOICE_AGENT_INSTRUCTIONS}\n\nCurrent case id: ${body.caseId}. Always include this case context when calling tools.`,
        output_modalities: ["audio"],
        tools: [...REALTIME_TOOLS],
        tool_choice: "auto",
        audio: {
          input: {
            transcription: { model: "whisper-1", language: "en" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
            },
          },
          output: {
            voice: "alloy",
          },
        },
      },
    });

    return NextResponse.json({
      clientSecret: secret.value,
      expiresAt: secret.expires_at,
      model,
      caseId: body.caseId,
    });
  } catch (error) {
    console.error("Failed to create realtime client secret:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create realtime client secret";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
