"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AuditEntry, CaseRecord, CoverageDecision } from "@/lib/types";

export function CaseDetail({ caseId }: { caseId: string }) {
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [overrideDecision, setOverrideDecision] =
    useState<CoverageDecision>("uncertain");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/cases/${caseId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load case");
      return;
    }
    setCaseRecord(data.case);
    setAudit(data.audit ?? []);
    if (data.case?.coverage?.decision) {
      setOverrideDecision(data.case.coverage.decision);
    }
  }, [caseId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Approval failed");
      setCaseRecord(data.case);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
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
        {caseRecord.smsPreview && (
          <div className="mb-4 rounded-md border border-[var(--ok)]/30 bg-[var(--ok)]/10 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ok)]">
              Simulated SMS sent
            </div>
            <p className="mt-1">{caseRecord.smsPreview}</p>
          </div>
        )}
        <label className="block text-sm text-[var(--muted)]">
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
            disabled={!canAct || busy || !caseRecord.coverage}
            onClick={() => approve(true)}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#042f2e]"
          >
            Approve suggestion
          </button>
          <select
            value={overrideDecision}
            onChange={(e) =>
              setOverrideDecision(e.target.value as CoverageDecision)
            }
            disabled={!canAct}
            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          >
            <option value="covered">covered</option>
            <option value="not_covered">not_covered</option>
            <option value="uncertain">uncertain</option>
          </select>
          <button
            type="button"
            disabled={!canAct || busy}
            onClick={() => approve(false)}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
          >
            Override & notify
          </button>
        </div>
      </Panel>

      <Panel title="Audit log">
        <ul className="space-y-2 font-mono text-xs text-[var(--muted)]">
          {audit.length === 0 && <li>No events.</li>}
          {audit.map((entry) => (
            <li key={entry.id}>
              {entry.at} · {entry.actor} · {entry.action}
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
