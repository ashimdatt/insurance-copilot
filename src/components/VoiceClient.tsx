"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseRecord, ExtractedFields } from "@/lib/types";
import { VOICE_OPENING_INSTRUCTIONS } from "@/lib/voice";

type ConnState = "idle" | "connecting" | "live" | "ended" | "error";

export function VoiceClient() {
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [connState, setConnState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [textInput, setTextInput] = useState("");
  const [textBusy, setTextBusy] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hangupAfterResponseRef = useRef(false);
  const hangupResponseIdRef = useRef<string | null>(null);
  const hangupDoneSkipsRef = useRef(0);
  const hangupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopVoiceRef = useRef<() => void>(() => {});

  const pushEvent = useCallback((line: string) => {
    setEvents((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 40));
  }, []);

  const refreshCase = useCallback(async (id: string) => {
    const res = await fetch(`/api/cases/${id}`);
    const data = await res.json();
    if (data.case) setCaseRecord(data.case);
  }, []);

  const ensureCase = useCallback(async () => {
    if (caseRecord) return caseRecord;
    const res = await fetch("/api/cases", { method: "POST" });
    const data = await res.json();
    setCaseRecord(data.case);
    pushEvent(`Case created ${data.case.id}`);
    return data.case as CaseRecord;
  }, [caseRecord, pushEvent]);

  const stopVoice = useCallback(() => {
    if (hangupTimerRef.current) {
      clearTimeout(hangupTimerRef.current);
      hangupTimerRef.current = null;
    }
    hangupAfterResponseRef.current = false;
    hangupResponseIdRef.current = null;
    hangupDoneSkipsRef.current = 0;
    dcRef.current?.close();
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    dcRef.current = null;
    pcRef.current = null;
    setConnState((s) => (s === "live" || s === "connecting" ? "ended" : s));
  }, []);

  useEffect(() => {
    stopVoiceRef.current = stopVoice;
  }, [stopVoice]);

  const scheduleHangupAfterClosing = useCallback(() => {
    // Arm hangup for the *next* response.created (the closing speech),
    // not the prior response that issued the tool call.
    hangupAfterResponseRef.current = true;
    hangupResponseIdRef.current = null;
    hangupDoneSkipsRef.current = 0;
    pushEvent("Will end call after the agent finishes speaking");
  }, [pushEvent]);

  const handleToolCall = useCallback(
    async (caseId: string, callId: string, name: string, argsJson: string) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      pushEvent(`Tool → ${name}`);
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, name, arguments: args }),
      });
      const result = await res.json();
      if (result.case) setCaseRecord(result.case);
      const output = JSON.stringify(result);

      const endCallAfterThis =
        name === "complete_intake" || Boolean(result.autoEscalated);

      dcRef.current?.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output,
          },
        }),
      );

      if (endCallAfterThis) {
        scheduleHangupAfterClosing();
        dcRef.current?.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: result.suggestedClosing
                ? `Speak this closing to the caller now, then stop. Do not ask another question: ${result.suggestedClosing}`
                : result.suggestedSpeak
                  ? `Speak this to the caller now, then the closing if provided, then stop. Do not ask another question: ${result.suggestedSpeak}${
                      result.suggestedClosing
                        ? ` ${result.suggestedClosing}`
                        : ""
                    }`
                  : "Thank the caller briefly, say you are ending the call now, and stop. Do not ask another question.",
            },
          }),
        );
      } else {
        dcRef.current?.send(JSON.stringify({ type: "response.create" }));
      }
      pushEvent(`Tool ← ${name} ok`);
    },
    [pushEvent, scheduleHangupAfterClosing],
  );
  const startVoice = useCallback(async () => {
    setError(null);
    setConnState("connecting");
    try {
      const current = await ensureCase();
      const tokenRes = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: current.id }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(tokenData.error || "Failed to create realtime session");
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = audioRef.current;
      if (audio) {
        pc.ontrack = (event) => {
          audio.srcObject = event.streams[0];
        };
      }

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      ms.getTracks().forEach((track) => pc.addTrack(track, ms));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        pushEvent("Realtime data channel open");
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: VOICE_OPENING_INSTRUCTIONS,
            },
          }),
        );
      };
      dc.onmessage = async (event) => {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          transcript?: string;
          call_id?: string;
          name?: string;
          arguments?: string;
          response?: { id?: string };
          response_id?: string;
        };
        const responseId = msg.response?.id || msg.response_id || null;

        if (msg.type === "response.audio_transcript.done" && msg.transcript) {
          pushEvent(`Agent: ${msg.transcript}`);
        }
        if (
          msg.type === "conversation.item.input_audio_transcription.completed" &&
          msg.transcript
        ) {
          pushEvent(`Caller: ${msg.transcript}`);
          await fetch(`/api/cases/${current.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcriptChunk: `Caller: ${msg.transcript}`,
            }),
          });
          await refreshCase(current.id);
        }
        if (msg.type === "response.function_call_arguments.done") {
          await handleToolCall(
            current.id,
            msg.call_id || "",
            msg.name || "",
            msg.arguments || "{}",
          );
          await refreshCase(current.id);
        }

        // Capture the closing response id so we don't hang up on the
        // earlier tool-call response.done.
        if (
          msg.type === "response.created" &&
          hangupAfterResponseRef.current &&
          !hangupResponseIdRef.current &&
          responseId
        ) {
          hangupResponseIdRef.current = responseId;
        }

        const isMatchedClosingDone =
          hangupAfterResponseRef.current &&
          hangupResponseIdRef.current &&
          responseId === hangupResponseIdRef.current &&
          (msg.type === "response.done" ||
            msg.type === "output_audio_buffer.stopped");

        // Fallback if response ids are missing: skip the tool-call response.done,
        // hang up on the following closing response.done.
        let isFallbackClosingDone = false;
        if (
          hangupAfterResponseRef.current &&
          !hangupResponseIdRef.current &&
          msg.type === "response.done"
        ) {
          hangupDoneSkipsRef.current += 1;
          isFallbackClosingDone = hangupDoneSkipsRef.current >= 2;
        }

        if (isMatchedClosingDone || isFallbackClosingDone) {
          // response.done often arrives before playback finishes; give the closing
          // sentence time to finish speaking before tearing down WebRTC.
          const delayMs = 9000;
          hangupAfterResponseRef.current = false;
          hangupResponseIdRef.current = null;
          hangupDoneSkipsRef.current = 0;
          pushEvent("Closing generated — waiting for speech to finish before ending call");
          if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
          hangupTimerRef.current = setTimeout(() => {
            stopVoiceRef.current();
            pushEvent("Call ended automatically");
          }, delayMs);
        }
      };

      // Ensure we can receive remote audio from the model.
      pc.addTransceiver("audio", { direction: "sendrecv" });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Current WebRTC handshake endpoint is /v1/realtime/calls
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpRes.ok) {
        const errText = await sdpRes.text();
        throw new Error(`Realtime SDP exchange failed: ${errText}`);
      }
      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: await sdpRes.text(),
      };
      await pc.setRemoteDescription(answer);
      setConnState("live");
      pushEvent("Voice session live");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Voice start failed");
      setConnState("error");
      stopVoice();
    }
  }, [ensureCase, handleToolCall, pushEvent, refreshCase, stopVoice]);

  useEffect(() => () => stopVoice(), [stopVoice]);

  async function shareLocation() {
    const current = await ensureCase();
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser");
      return;
    }
    pushEvent("Getting GPS…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let locationText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        try {
          const geoRes = await fetch(
            `/api/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
          );
          const geo = await geoRes.json();
          if (geo.locationText) locationText = String(geo.locationText);
        } catch (geoErr) {
          console.error("Reverse geocode failed:", geoErr);
        }

        const fields: ExtractedFields = {
          locationLat: lat,
          locationLng: lng,
          locationText,
        };
        const res = await fetch(`/api/cases/${current.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
        const data = await res.json();
        setCaseRecord(data.case);
        pushEvent(`GPS shared: ${locationText}`);
        if (dcRef.current?.readyState === "open") {
          dcRef.current.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `I shared my GPS. My location is ${locationText}. Coordinates are latitude ${lat}, longitude ${lng}. Please save the place name as the location, confirm it back to me in plain English, and ask if that looks right.`,
                  },
                ],
              },
            }),
          );
          dcRef.current.send(
            JSON.stringify({
              type: "response.create",
              response: {
                instructions:
                  "Confirm the caller's physical place name clearly in English (not raw lat/long). Ask if that location is correct or if they need to update it.",
              },
            }),
          );
        }
      },
      (geoErr) => setError(geoErr.message),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function submitTextIntake() {
    if (!textInput.trim()) return;
    setTextBusy(true);
    setError(null);
    try {
      const current = await ensureCase();
      const res = await fetch("/api/intake/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: current.id, message: textInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Text intake failed");
      setCaseRecord(data.case);
      pushEvent(`You: ${textInput.trim()}`);
      if (data.assistantMessage) pushEvent(`Agent: ${data.assistantMessage}`);
      setTextInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Text intake failed");
    } finally {
      setTextBusy(false);
    }
  }

  async function finishTextIntake() {
    const current = await ensureCase();
    setTextBusy(true);
    try {
      const res = await fetch(`/api/cases/${current.id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalSummary: "Text intake completed by caller." }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyze failed");
      setCaseRecord(data.case);
      if (data.suggestedClosing) {
        pushEvent(`Agent: ${data.suggestedClosing}`);
      } else {
        pushEvent("Intake complete → pending agent review");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analyze failed");
    } finally {
      setTextBusy(false);
    }
  }

  const fields = caseRecord?.fields;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Driver intake</h1>
            <p className="text-sm text-[var(--muted)]">
              {caseRecord ? `Case ${caseRecord.id}` : "No case yet"}
              {caseRecord?.identityVerified ? " · identity verified" : ""}
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 ${mode === "voice" ? "bg-[var(--accent)] text-[#042f2e] font-semibold" : "border border-[var(--border)]"}`}
              onClick={() => setMode("voice")}
            >
              Voice
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1.5 ${mode === "text" ? "bg-[var(--accent)] text-[#042f2e] font-semibold" : "border border-[var(--border)]"}`}
              onClick={() => setMode("text")}
            >
              Text fallback
            </button>
          </div>
        </div>

        <audio ref={audioRef} autoPlay className="hidden" />

        {mode === "voice" ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Uses OpenAI Realtime over WebRTC. The agent collects facts only
              and never discusses coverage.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={startVoice}
                disabled={connState === "connecting" || connState === "live"}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#042f2e]"
              >
                {connState === "live" ? "Connected" : "Start call"}
              </button>
              <button
                type="button"
                onClick={stopVoice}
                disabled={connState !== "live" && connState !== "connecting"}
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
              >
                End call
              </button>
              <button
                type="button"
                onClick={shareLocation}
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
              >
                Share GPS
              </button>
            </div>
            <p className="font-mono text-xs text-[var(--muted)]">
              Status: {connState}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-[var(--muted)]">
              Chat-style intake when mic or Realtime is unavailable. Same
              backend tools and coverage pipeline.
            </p>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              rows={4}
              placeholder="e.g. I'm Jordan Lee, DOB 1988-04-12. Flat tire on my Toyota Camry near downtown SF."
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-dim)]"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={textBusy}
                onClick={submitTextIntake}
                className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#042f2e]"
              >
                Send
              </button>
              <button
                type="button"
                disabled={textBusy || !caseRecord}
                onClick={finishTextIntake}
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
              >
                Finish intake & analyze
              </button>
              <button
                type="button"
                onClick={shareLocation}
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
              >
                Share GPS
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-semibold">Live log</h2>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto font-mono text-xs text-[var(--muted)]">
            {events.length === 0 && <li>No events yet.</li>}
            {events.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <aside className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-5">
        <h2 className="text-sm font-semibold">Extracted fields</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {[
            ["Name", fields?.policyholderName],
            ["DOB", fields?.dateOfBirth],
            ["Vehicle", [fields?.vehicleYear, fields?.vehicleMake, fields?.vehicleModel].filter(Boolean).join(" ")],
            ["Plate", fields?.plate],
            ["Damage", fields?.damageType],
            ["Location", fields?.locationText],
            ["Mobile", fields?.contactPhone],
            ["Situation", fields?.situation || fields?.damageDescription],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-3 border-b border-[var(--border)]/60 py-1.5">
              <dt className="text-[var(--muted)]">{label}</dt>
              <dd className="text-right">{value || "—"}</dd>
            </div>
          ))}
        </dl>
        {caseRecord?.status === "pending_review" ||
        caseRecord?.status === "notified" ||
        caseRecord?.status === "approved" ? (
          <a
            href={`/dashboard/${caseRecord.id}`}
            className="mt-5 inline-block rounded-md border border-[var(--accent-dim)] px-3 py-2 text-sm text-[var(--accent)]"
          >
            Open in agent dashboard →
          </a>
        ) : null}
      </aside>
    </div>
  );
}
