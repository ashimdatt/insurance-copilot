"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditEntry, CaseRecord, CoverageDecision } from "@/lib/types";

export function CaseDetail({ caseId }: { caseId: string }) {
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [agentId, setAgentId] = useState("agent-demo-001");
  const [smsDraft, setSmsDraft] = useState("");
  const [smsTouched, setSmsTouched] = useState(false);
  const [overrideDecision, setOverrideDecision] =
    useState<CoverageDecision>("uncertain");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chainStatus, setChainStatus] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Don't let the 5s poll overwrite a choice the agent already made in the UI
  const decisionTouchedRef = useRef(false);
  const decisionSeededRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/cases/${caseId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load case");
      return;
    }
    setCaseRecord(data.case);
    setAudit(data.audit ?? []);
    if (data.case?.smsPreview && !smsTouched) {
      setSmsDraft(data.case.smsPreview);
    }
    if (
      data.case?.coverage?.decision &&
      !decisionTouchedRef.current &&
      !decisionSeededRef.current
    ) {
      setOverrideDecision(data.case.coverage.decision);
      decisionSeededRef.current = true;
    }
  }, [caseId, smsTouched]);

  const verifyChain = useCallback(async () => {
    const res = await fetch(`/api/cases/${caseId}/audit`);
    const data = await res.json();
    if (!res.ok) {
      setChainStatus(data.error || "Verify failed");
      return;
    }
    setChainStatus(
      data.verification?.ok
        ? `✓ ${data.verification.message}`
        : `✗ ${data.verification?.message}`,
    );
    if (data.audit) setAudit(data.audit);
  }, [caseId]);

  useEffect(() => {
    decisionTouchedRef.current = false;
    decisionSeededRef.current = false;
    setSmsTouched(false);
    setSmsDraft("");
    load();
    verifyChain();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load, verifyChain]);

  async function approve(acceptSuggestion: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptSuggestion,
          humanDecision: acceptSuggestion ? undefined : overrideDecision,
          humanNotes: notes || undefined,
          agentId: agentId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approval failed");
      setCaseRecord(data.case);
      if (data.case?.smsPreview) {
        setSmsDraft(data.case.smsPreview);
        setSmsTouched(false);
      }
      await verifyChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendSms() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: smsDraft,
          agentId: agentId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send SMS");
      setCaseRecord(data.case);
      setSmsTouched(false);
      if (data.case?.smsPreview) setSmsDraft(data.case.smsPreview);
      await verifyChain();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send SMS");
    } finally {
      setBusy(false);
    }
  }

  if (!caseRecord) {
    return (
      <p className="text-sm text-[var(--muted)]">
        {error || "Loading case…"}
      </p>
    );
  }

  const canAct =
    caseRecord.status === "pending_review" ||
    caseRecord.status === "intake" ||
    caseRecord.status === "escalated";

  const awaitingSmsSend =
    caseRecord.status === "approved" || caseRecord.status === "overridden";
  const smsSent = caseRecord.status === "notified";

  const aiDecision = caseRecord.coverage?.decision ?? null;
  const isChangingDecision =
    aiDecision != null && overrideDecision !== aiDecision;
  const canApprove = canAct && Boolean(caseRecord.coverage) && !isChangingDecision;
  const canOverride = canAct && isChangingDecision;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
          >
            ← Queue
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-semibold">
            {caseRecord.id}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Status {caseRecord.status}
            {caseRecord.flagged ? " · flagged for review" : ""}
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Extracted fields">
          <Field label="Name" value={caseRecord.fields.policyholderName} />
          <Field label="DOB" value={caseRecord.fields.dateOfBirth} />
          <Field
            label="Verified"
            value={caseRecord.identityVerified ? "yes" : "no"}
          />
          <Field
            label="Vehicle"
            value={[
              caseRecord.fields.vehicleYear,
              caseRecord.fields.vehicleMake,
              caseRecord.fields.vehicleModel,
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <Field label="Plate" value={caseRecord.fields.plate} />
          <Field label="Damage" value={caseRecord.fields.damageType} />
          <Field label="Location" value={caseRecord.fields.locationText} />
          <Field label="Mobile" value={caseRecord.fields.contactPhone} />
          <Field
            label="Situation"
            value={
              caseRecord.fields.situation ||
              caseRecord.fields.damageDescription
            }
          />
        </Panel>

        <Panel title="Coverage decision">
          {caseRecord.coverage ? (
            <>
              <Field label="Decision" value={caseRecord.coverage.decision} />
              <Field
                label="Confidence"
                value={`${Math.round(caseRecord.coverage.confidence * 100)}%`}
              />
              <Field label="Clause" value={caseRecord.coverage.clauseId} />
              <p className="mt-3 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-relaxed text-[var(--muted)]">
                {caseRecord.coverage.clauseText ||
                  "No clause citation (auto-escalate)."}
              </p>
              <p className="mt-2 text-sm">{caseRecord.coverage.rationale}</p>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Analysis not run yet. Finish intake first.
            </p>
          )}
        </Panel>

        <Panel title="Next best action">
          {caseRecord.nba ? (
            <>
              <Field label="Action" value={caseRecord.nba.action} />
              <Field label="Garage" value={caseRecord.nba.garageName} />
              <Field
                label="Distance"
                value={
                  caseRecord.nba.distanceKm != null
                    ? `${caseRecord.nba.distanceKm} km`
                    : undefined
                }
              />
              <p className="mt-2 text-sm text-[var(--muted)]">
                {caseRecord.nba.rationale}
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">No recommendation yet.</p>
          )}
        </Panel>

        <Panel title="Transcript">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--muted)]">
            {caseRecord.transcript || "Empty"}
          </pre>
          {caseRecord.redactedTranscript && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Redacted (model input)
              </h3>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--muted)]">
                {caseRecord.redactedTranscript}
              </pre>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Human approval">
        {smsSent && caseRecord.smsPreview && (
          <div className="mb-4 rounded-md border border-[var(--ok)]/30 bg-[var(--ok)]/10 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ok)]">
              Simulated SMS sent
            </div>
            <p className="mt-1">{caseRecord.smsPreview}</p>
          </div>
        )}
        <label className="block text-sm text-[var(--muted)]">
          Agent ID (recorded on approve/override)
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={!canAct && !awaitingSmsSend}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
            placeholder="agent-demo-001"
          />
        </label>
        <label className="mt-3 block text-sm text-[var(--muted)]">
          Notes / override reason
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            disabled={!canAct}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canApprove || busy}
            onClick={() => approve(true)}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#042f2e]"
            title={
              isChangingDecision
                ? "Dropdown differs from the AI suggestion. Use Override decision, or set the dropdown back to the AI decision."
                : undefined
            }
          >
            Approve suggestion
            {aiDecision ? ` (${aiDecision.replace("_", " ")})` : ""}
          </button>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            Decision
            <select
              value={overrideDecision}
              onChange={(e) => {
                decisionTouchedRef.current = true;
                setOverrideDecision(e.target.value as CoverageDecision);
              }}
              disabled={!canAct}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
            >
              <option value="covered">covered</option>
              <option value="not_covered">not covered</option>
              <option value="uncertain">uncertain</option>
            </select>
          </label>
          <button
            type="button"
            disabled={!canOverride || busy}
            onClick={() => approve(false)}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
            title={
              !isChangingDecision
                ? "Change the dropdown away from the AI suggestion to enable override."
                : undefined
            }
          >
            Override decision
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {awaitingSmsSend
            ? "Decision saved. Review the SMS below, edit if needed, then click Send SMS."
            : isChangingDecision
              ? `Dropdown is ${overrideDecision.replace("_", " ")}, which differs from the AI suggestion (${aiDecision?.replace("_", " ")}). Approve is disabled — click Override decision.`
              : "Dropdown matches the AI suggestion. Approve or override first; SMS is confirmed in a second step."}
        </p>

        {(awaitingSmsSend || smsSent) && (
          <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="text-sm font-semibold">
              {smsSent ? "SMS sent (simulated)" : "Confirm SMS before sending"}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              To{" "}
              {caseRecord.fields.contactPhone ||
                "policy mobile on file"}
              {!smsSent && " — edit the message if needed, then send."}
            </p>
            <textarea
              value={smsDraft}
              onChange={(e) => {
                setSmsTouched(true);
                setSmsDraft(e.target.value);
              }}
              rows={5}
              disabled={smsSent || busy}
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-dim)]"
            />
            {!smsSent && (
              <button
                type="button"
                disabled={busy || !smsDraft.trim()}
                onClick={sendSms}
                className="mt-3 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#042f2e]"
              >
                Send SMS
              </button>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Audit trail (append-only hash chain)">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={verifyChain}
            className="rounded-md border border-[var(--border)] px-3 py-1.5"
          >
            Verify chain
          </button>
          {chainStatus && (
            <span
              className={
                chainStatus.startsWith("✓")
                  ? "text-[var(--ok)]"
                  : "text-[var(--danger)]"
              }
            >
              {chainStatus}
            </span>
          )}
        </div>
        <ul className="space-y-2">
          {audit.length === 0 && (
            <li className="text-sm text-[var(--muted)]">No events.</li>
          )}
          {audit.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md border border-[var(--border)]/70 bg-[var(--bg)] p-2"
            >
              <button
                type="button"
                className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left font-mono text-xs"
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
              >
                <span>
                  #{entry.seq ?? "?"} · {entry.at} · {entry.actor}
                  {entry.actorId ? `/${entry.actorId}` : ""} · {entry.action}
                </span>
                <span className="text-[var(--muted)]">
                  {(entry.entryHash || "").slice(0, 12)}…
                </span>
              </button>
              {expandedId === entry.id && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--muted)]">
                  {JSON.stringify(
                    {
                      id: entry.id,
                      correlationId: entry.correlationId,
                      prevHash: entry.prevHash,
                      entryHash: entry.entryHash,
                      detail: entry.detail,
                    },
                    null,
                    2,
                  )}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--border)]/50 py-1.5 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right">{value || "—"}</span>
    </div>
  );
}
