"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CaseRecord } from "@/lib/types";

const STATUS_COLOR: Record<string, string> = {
  intake: "text-[var(--muted)]",
  pending_review: "text-[var(--warn)]",
  approved: "text-[var(--ok)]",
  overridden: "text-[var(--accent)]",
  notified: "text-[var(--ok)]",
  escalated: "text-[var(--danger)]",
};

export function CaseQueue() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/cases");
      const data = await res.json();
      setCases(data.cases ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cases");
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agent dashboard</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Approve coverage and dispatch. Uncertain or denial cases are
            flagged.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg-panel)] text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Case</th>
              <th className="px-4 py-3 font-medium">Caller</th>
              <th className="px-4 py-3 font-medium">Damage</th>
              <th className="px-4 py-3 font-medium">Coverage</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--muted)]"
                >
                  No cases yet. Start an intake from the voice page.
                </td>
              </tr>
            )}
            {cases.map((c) => (
              <tr
                key={c.id}
                className="border-t border-[var(--border)] hover:bg-[var(--bg-elevated)]"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/${c.id}`}
                    className="font-mono text-[var(--accent)] hover:underline"
                  >
                    {c.id}
                  </Link>
                  {c.flagged && (
                    <span className="ml-2 text-xs text-[var(--warn)]">
                      flagged
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.fields.policyholderName || "—"}
                </td>
                <td className="px-4 py-3">{c.fields.damageType || "—"}</td>
                <td className="px-4 py-3">
                  {c.coverage?.decision ?? "—"}
                  {c.coverage ? (
                    <span className="ml-1 text-xs text-[var(--muted)]">
                      ({Math.round(c.coverage.confidence * 100)}%)
                    </span>
                  ) : null}
                </td>
                <td
                  className={`px-4 py-3 font-medium ${STATUS_COLOR[c.status] || ""}`}
                >
                  {c.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
