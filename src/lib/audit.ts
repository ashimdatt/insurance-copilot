import { createHash, randomUUID } from "crypto";
import type { AuditActor, AuditEntry } from "./types";
import { getDb } from "./db";

const GENESIS_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export type AuditWriteInput = {
  caseId: string;
  actor: AuditActor;
  action: string;
  detail?: Record<string, unknown>;
  actorId?: string | null;
  correlationId?: string | null;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function computeEntryHash(input: {
  prevHash: string;
  id: string;
  caseId: string;
  seq: number;
  at: string;
  actor: string;
  actorId: string | null;
  action: string;
  correlationId: string | null;
  detail: Record<string, unknown>;
}): string {
  const payload = stableStringify({
    prevHash: input.prevHash,
    id: input.id,
    caseId: input.caseId,
    seq: input.seq,
    at: input.at,
    actor: input.actor,
    actorId: input.actorId,
    action: input.action,
    correlationId: input.correlationId,
    detail: input.detail,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function ensureAuditSchema() {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(audit_log)").all() as Array<{
    name: string;
  }>;
  const names = new Set(cols.map((c) => c.name));

  const add = (sql: string) => db.exec(sql);
  if (!names.has("seq")) add("ALTER TABLE audit_log ADD COLUMN seq INTEGER");
  if (!names.has("actor_id"))
    add("ALTER TABLE audit_log ADD COLUMN actor_id TEXT");
  if (!names.has("correlation_id"))
    add("ALTER TABLE audit_log ADD COLUMN correlation_id TEXT");
  if (!names.has("prev_hash"))
    add("ALTER TABLE audit_log ADD COLUMN prev_hash TEXT");
  if (!names.has("entry_hash"))
    add("ALTER TABLE audit_log ADD COLUMN entry_hash TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_case_seq ON audit_log(case_id, seq);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
  `);

  // Append-only enforcement
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;
  `);

  // Backfill hash chain for legacy rows missing hashes
  const legacy = db
    .prepare(
      `SELECT id, case_id, at, actor, action, detail_json, seq, actor_id,
              correlation_id, prev_hash, entry_hash
       FROM audit_log
       WHERE entry_hash IS NULL OR entry_hash = ''
       ORDER BY CASE WHEN seq IS NULL THEN 1 ELSE 0 END, seq ASC, at ASC, id ASC`,
    )
    .all() as Array<{
    id: string;
    case_id: string;
    at: string;
    actor: string;
    action: string;
    detail_json: string;
    seq: number | null;
    actor_id: string | null;
    correlation_id: string | null;
    prev_hash: string | null;
    entry_hash: string | null;
  }>;

  if (legacy.length === 0) return;

  // Temporarily drop triggers for backfill only
  db.exec(`DROP TRIGGER IF EXISTS audit_log_no_update;
           DROP TRIGGER IF EXISTS audit_log_no_delete;`);

  const lastByCase = new Map<string, { seq: number; hash: string }>();
  const existingHashed = db
    .prepare(
      `SELECT case_id, seq, entry_hash FROM audit_log
       WHERE entry_hash IS NOT NULL AND entry_hash != ''
       ORDER BY seq ASC`,
    )
    .all() as Array<{ case_id: string; seq: number; entry_hash: string }>;
  for (const row of existingHashed) {
    lastByCase.set(row.case_id, { seq: row.seq, hash: row.entry_hash });
  }

  const update = db.prepare(
    `UPDATE audit_log
     SET seq = ?, actor_id = ?, correlation_id = ?, prev_hash = ?, entry_hash = ?
     WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    for (const row of legacy) {
      const prev = lastByCase.get(row.case_id);
      const seq = prev ? prev.seq + 1 : 1;
      const prevHash = prev?.hash ?? GENESIS_HASH;
      const actorId = row.actor_id ?? null;
      const correlationId = row.correlation_id ?? row.case_id;
      const detail = JSON.parse(row.detail_json) as Record<string, unknown>;
      const entryHash = computeEntryHash({
        prevHash,
        id: row.id,
        caseId: row.case_id,
        seq,
        at: row.at,
        actor: row.actor,
        actorId,
        action: row.action,
        correlationId,
        detail,
      });
      update.run(seq, actorId, correlationId, prevHash, entryHash, row.id);
      lastByCase.set(row.case_id, { seq, hash: entryHash });
    }
  });
  tx();

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;
  `);
}

let schemaReady = false;

function ready() {
  if (!schemaReady) {
    ensureAuditSchema();
    schemaReady = true;
  }
}

/**
 * Append-only audit write with per-case sequence and hash chain.
 * Never updates or deletes prior rows.
 */
export function appendAudit(
  caseId: string,
  actor: AuditActor,
  action: string,
  detail: Record<string, unknown> = {},
  options: {
    actorId?: string | null;
    correlationId?: string | null;
  } = {},
): AuditEntry {
  ready();
  const db = getDb();
  const id = randomUUID();
  const at = new Date().toISOString();
  const actorId =
    options.actorId ??
    (actor === "human_agent"
      ? process.env.DEFAULT_AGENT_ID || "agent-unauthenticated"
      : actor === "system"
        ? "system"
        : actor === "voice_agent"
          ? "voice-agent"
          : "customer");
  const correlationId = options.correlationId ?? caseId;

  const last = db
    .prepare(
      `SELECT seq, entry_hash FROM audit_log
       WHERE case_id = ? AND entry_hash IS NOT NULL
       ORDER BY seq DESC LIMIT 1`,
    )
    .get(caseId) as { seq: number; entry_hash: string } | undefined;

  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.entry_hash ?? GENESIS_HASH;
  const entryHash = computeEntryHash({
    prevHash,
    id,
    caseId,
    seq,
    at,
    actor,
    actorId,
    action,
    correlationId,
    detail,
  });

  db.prepare(
    `INSERT INTO audit_log (
      id, case_id, at, actor, action, detail_json,
      seq, actor_id, correlation_id, prev_hash, entry_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    caseId,
    at,
    actor,
    action,
    JSON.stringify(detail),
    seq,
    actorId,
    correlationId,
    prevHash,
    entryHash,
  );

  return {
    id,
    caseId,
    at,
    actor,
    actorId,
    action,
    correlationId,
    seq,
    prevHash,
    entryHash,
    detail,
  };
}

export function listAudit(caseId: string): AuditEntry[] {
  ready();
  const rows = getDb()
    .prepare(
      `SELECT * FROM audit_log WHERE case_id = ?
       ORDER BY COALESCE(seq, 0) ASC, at ASC`,
    )
    .all(caseId) as Array<{
    id: string;
    case_id: string;
    at: string;
    actor: AuditActor;
    action: string;
    detail_json: string;
    seq: number | null;
    actor_id: string | null;
    correlation_id: string | null;
    prev_hash: string | null;
    entry_hash: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    at: row.at,
    actor: row.actor,
    actorId: row.actor_id,
    action: row.action,
    correlationId: row.correlation_id,
    seq: row.seq,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
    detail: JSON.parse(row.detail_json) as Record<string, unknown>,
  }));
}

export function verifyAuditChain(caseId: string): {
  ok: boolean;
  checked: number;
  brokenAt: string | null;
  message: string;
} {
  ready();
  const entries = listAudit(caseId);
  if (entries.length === 0) {
    return {
      ok: true,
      checked: 0,
      brokenAt: null,
      message: "No audit events for this case.",
    };
  }

  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAt: entry.id,
        message: `Sequence gap at ${entry.id}: expected seq ${expectedSeq}, got ${entry.seq}`,
      };
    }
    if (entry.prevHash !== expectedPrev) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAt: entry.id,
        message: `prev_hash mismatch at ${entry.id}`,
      };
    }
    const recomputed = computeEntryHash({
      prevHash: entry.prevHash || GENESIS_HASH,
      id: entry.id,
      caseId: entry.caseId,
      seq: entry.seq || expectedSeq,
      at: entry.at,
      actor: entry.actor,
      actorId: entry.actorId ?? null,
      action: entry.action,
      correlationId: entry.correlationId ?? caseId,
      detail: entry.detail,
    });
    if (recomputed !== entry.entryHash) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAt: entry.id,
        message: `entry_hash mismatch at ${entry.id} (tamper or schema drift)`,
      };
    }
    expectedPrev = entry.entryHash || recomputed;
    expectedSeq += 1;
  }

  return {
    ok: true,
    checked: entries.length,
    brokenAt: null,
    message: `Chain intact across ${entries.length} events.`,
  };
}

/** Call once after getDb() so migrations/backfill run early. */
export function initAudit(): void {
  ready();
}
