import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  CaseRecord,
  CaseStatus,
  CoverageResult,
  ExtractedFields,
  Garage,
  NbaResult,
  PolicyClause,
  Policyholder,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "copilot.db");

type PolicyFile = {
  id: string;
  name: string;
  version: string;
  clauses: Array<{
    id: string;
    section: string;
    title: string;
    text: string;
    covers: string[];
  }>;
};

let dbInstance: Database.Database | null = null;

function readJson<T>(filename: string): T {
  const raw = fs.readFileSync(path.join(DATA_DIR, filename), "utf8");
  return JSON.parse(raw) as T;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS policyholders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      vehicle_make TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      vehicle_year TEXT NOT NULL,
      plate TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_clauses (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      section TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      covers_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS garages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      supports_tow INTEGER NOT NULL,
      supports_repair INTEGER NOT NULL,
      supports_ev INTEGER NOT NULL DEFAULT 0,
      phone TEXT NOT NULL,
      address TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      transcript TEXT NOT NULL DEFAULT '',
      redacted_transcript TEXT NOT NULL DEFAULT '',
      identity_verified INTEGER NOT NULL DEFAULT 0,
      policyholder_id TEXT,
      policy_id TEXT,
      coverage_json TEXT,
      nba_json TEXT,
      human_decision TEXT,
      human_notes TEXT,
      sms_preview TEXT,
      flagged INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      seq INTEGER,
      actor_id TEXT,
      correlation_id TEXT,
      prev_hash TEXT,
      entry_hash TEXT
    );
  `);

  // Existing DBs created before EV support
  const garageCols = db.prepare("PRAGMA table_info(garages)").all() as Array<{
    name: string;
  }>;
  if (!garageCols.some((c) => c.name === "supports_ev")) {
    db.exec(
      "ALTER TABLE garages ADD COLUMN supports_ev INTEGER NOT NULL DEFAULT 0",
    );
  }
}

function seedIfEmpty(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM policyholders").get() as {
    c: number;
  };
  if (count.c > 0) return;

  const policyholders = readJson<Policyholder[]>("policyholders.json");
  const policies = readJson<PolicyFile[]>("policies.json");
  const garages = readJson<Garage[]>("garages.json");

  const insertPh = db.prepare(`
    INSERT INTO policyholders (
      id, name, date_of_birth, policy_id, phone,
      vehicle_make, vehicle_model, vehicle_year, plate
    ) VALUES (
      @id, @name, @dateOfBirth, @policyId, @phone,
      @vehicleMake, @vehicleModel, @vehicleYear, @plate
    )
  `);

  const insertClause = db.prepare(`
    INSERT INTO policy_clauses (
      id, policy_id, section, title, text, covers_json
    ) VALUES (
      @id, @policyId, @section, @title, @text, @coversJson
    )
  `);

  const insertGarage = db.prepare(`
    INSERT INTO garages (
      id, name, lat, lng, supports_tow, supports_repair, supports_ev, phone, address
    ) VALUES (
      @id, @name, @lat, @lng, @supportsTow, @supportsRepair, @supportsEv, @phone, @address
    )
  `);

  const tx = db.transaction(() => {
    for (const ph of policyholders) {
      insertPh.run(ph);
    }
    for (const policy of policies) {
      for (const clause of policy.clauses) {
        insertClause.run({
          id: clause.id,
          policyId: policy.id,
          section: clause.section,
          title: clause.title,
          text: clause.text,
          coversJson: JSON.stringify(clause.covers),
        });
      }
    }
    for (const g of garages) {
      insertGarage.run({
        id: g.id,
        name: g.name,
        lat: g.lat,
        lng: g.lng,
        supportsTow: g.supportsTow ? 1 : 0,
        supportsRepair: g.supportsRepair ? 1 : 0,
        supportsEv: g.supportsEv ? 1 : 0,
        phone: g.phone,
        address: g.address,
      });
    }
  });

  tx();
}

/**
 * Re-apply JSON seed data into an existing DB (upsert).
 * Safe to run when JSON files change on a machine that already has copilot.db.
 */
export function syncSeedFromJson(): void {
  const db = getDb();
  const policyholders = readJson<Policyholder[]>("policyholders.json");
  const policies = readJson<PolicyFile[]>("policies.json");
  const garages = readJson<Garage[]>("garages.json");

  const upsertPh = db.prepare(`
    INSERT INTO policyholders (
      id, name, date_of_birth, policy_id, phone,
      vehicle_make, vehicle_model, vehicle_year, plate
    ) VALUES (
      @id, @name, @dateOfBirth, @policyId, @phone,
      @vehicleMake, @vehicleModel, @vehicleYear, @plate
    )
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      date_of_birth=excluded.date_of_birth,
      policy_id=excluded.policy_id,
      phone=excluded.phone,
      vehicle_make=excluded.vehicle_make,
      vehicle_model=excluded.vehicle_model,
      vehicle_year=excluded.vehicle_year,
      plate=excluded.plate
  `);

  const upsertClause = db.prepare(`
    INSERT INTO policy_clauses (
      id, policy_id, section, title, text, covers_json
    ) VALUES (
      @id, @policyId, @section, @title, @text, @coversJson
    )
    ON CONFLICT(id) DO UPDATE SET
      policy_id=excluded.policy_id,
      section=excluded.section,
      title=excluded.title,
      text=excluded.text,
      covers_json=excluded.covers_json
  `);

  const upsertGarage = db.prepare(`
    INSERT INTO garages (
      id, name, lat, lng, supports_tow, supports_repair, supports_ev, phone, address
    ) VALUES (
      @id, @name, @lat, @lng, @supportsTow, @supportsRepair, @supportsEv, @phone, @address
    )
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      lat=excluded.lat,
      lng=excluded.lng,
      supports_tow=excluded.supports_tow,
      supports_repair=excluded.supports_repair,
      supports_ev=excluded.supports_ev,
      phone=excluded.phone,
      address=excluded.address
  `);

  const tx = db.transaction(() => {
    for (const ph of policyholders) upsertPh.run(ph);
    for (const policy of policies) {
      for (const clause of policy.clauses) {
        upsertClause.run({
          id: clause.id,
          policyId: policy.id,
          section: clause.section,
          title: clause.title,
          text: clause.text,
          coversJson: JSON.stringify(clause.covers),
        });
      }
    }
    for (const g of garages) {
      upsertGarage.run({
        id: g.id,
        name: g.name,
        lat: g.lat,
        lng: g.lng,
        supportsTow: g.supportsTow ? 1 : 0,
        supportsRepair: g.supportsRepair ? 1 : 0,
        supportsEv: g.supportsEv ? 1 : 0,
        phone: g.phone,
        address: g.address,
      });
    }
  });
  tx();
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  migrate(db);
  seedIfEmpty(db);
  dbInstance = db;
  // Lazy: finish audit schema/backfill after DB is ready
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initAudit } = require("./audit") as typeof import("./audit");
  initAudit();
  return db;
}

function mapCase(row: Record<string, unknown>): CaseRecord {
  return {
    id: row.id as string,
    status: row.status as CaseStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    fields: JSON.parse(row.fields_json as string) as ExtractedFields,
    transcript: row.transcript as string,
    redactedTranscript: row.redacted_transcript as string,
    identityVerified: Boolean(row.identity_verified),
    policyholderId: (row.policyholder_id as string) || null,
    policyId: (row.policy_id as string) || null,
    coverage: row.coverage_json
      ? (JSON.parse(row.coverage_json as string) as CoverageResult)
      : null,
    nba: row.nba_json ? (JSON.parse(row.nba_json as string) as NbaResult) : null,
    humanDecision: (row.human_decision as CaseRecord["humanDecision"]) || null,
    humanNotes: (row.human_notes as string) || null,
    smsPreview: (row.sms_preview as string) || null,
    flagged: Boolean(row.flagged),
  };
}

export function createCase(fields: ExtractedFields = {}): CaseRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const id = `CASE-${randomUUID().slice(0, 8).toUpperCase()}`;
  db.prepare(
    `INSERT INTO cases (
      id, status, created_at, updated_at, fields_json, transcript, redacted_transcript
    ) VALUES (?, 'intake', ?, ?, ?, '', '')`,
  ).run(id, now, now, JSON.stringify(fields));
  // Lazy import avoids circular dependency with audit.ts
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { appendAudit, initAudit } = require("./audit") as typeof import("./audit");
  initAudit();
  appendAudit(id, "system", "case_created", { fields });
  return getCase(id)!;
}

export function getCase(id: string): CaseRecord | null {
  const row = getDb().prepare("SELECT * FROM cases WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapCase(row) : null;
}

export function listCases(): CaseRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM cases ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(mapCase);
}

export function updateCase(
  id: string,
  patch: Partial<{
    status: CaseStatus;
    fields: ExtractedFields;
    transcript: string;
    redactedTranscript: string;
    identityVerified: boolean;
    policyholderId: string | null;
    policyId: string | null;
    coverage: CoverageResult | null;
    nba: NbaResult | null;
    humanDecision: CaseRecord["humanDecision"];
    humanNotes: string | null;
    smsPreview: string | null;
    flagged: boolean;
  }>,
): CaseRecord | null {
  const existing = getCase(id);
  if (!existing) return null;

  const next: CaseRecord = {
    ...existing,
    status: patch.status ?? existing.status,
    fields: patch.fields ? { ...existing.fields, ...patch.fields } : existing.fields,
    transcript: patch.transcript ?? existing.transcript,
    redactedTranscript: patch.redactedTranscript ?? existing.redactedTranscript,
    identityVerified: patch.identityVerified ?? existing.identityVerified,
    policyholderId:
      patch.policyholderId !== undefined
        ? patch.policyholderId
        : existing.policyholderId,
    policyId: patch.policyId !== undefined ? patch.policyId : existing.policyId,
    coverage: patch.coverage !== undefined ? patch.coverage : existing.coverage,
    nba: patch.nba !== undefined ? patch.nba : existing.nba,
    humanDecision:
      patch.humanDecision !== undefined
        ? patch.humanDecision
        : existing.humanDecision,
    humanNotes:
      patch.humanNotes !== undefined ? patch.humanNotes : existing.humanNotes,
    smsPreview:
      patch.smsPreview !== undefined ? patch.smsPreview : existing.smsPreview,
    flagged: patch.flagged ?? existing.flagged,
    updatedAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `UPDATE cases SET
        status = ?,
        updated_at = ?,
        fields_json = ?,
        transcript = ?,
        redacted_transcript = ?,
        identity_verified = ?,
        policyholder_id = ?,
        policy_id = ?,
        coverage_json = ?,
        nba_json = ?,
        human_decision = ?,
        human_notes = ?,
        sms_preview = ?,
        flagged = ?
      WHERE id = ?`,
    )
    .run(
      next.status,
      next.updatedAt,
      JSON.stringify(next.fields),
      next.transcript,
      next.redactedTranscript,
      next.identityVerified ? 1 : 0,
      next.policyholderId,
      next.policyId,
      next.coverage ? JSON.stringify(next.coverage) : null,
      next.nba ? JSON.stringify(next.nba) : null,
      next.humanDecision,
      next.humanNotes,
      next.smsPreview,
      next.flagged ? 1 : 0,
      id,
    );

  return getCase(id);
}

export function findPolicyholderByIdentity(
  name: string,
  dateOfBirth: string,
): Policyholder | null {
  const normalizedName = name.trim().toLowerCase();
  const dob = dateOfBirth.trim();
  const rows = getDb()
    .prepare("SELECT * FROM policyholders")
    .all() as Array<{
    id: string;
    name: string;
    date_of_birth: string;
    policy_id: string;
    phone: string;
    vehicle_make: string;
    vehicle_model: string;
    vehicle_year: string;
    plate: string;
  }>;

  const match = rows.find(
    (row) =>
      row.name.toLowerCase() === normalizedName && row.date_of_birth === dob,
  );
  if (!match) return null;

  return {
    id: match.id,
    name: match.name,
    dateOfBirth: match.date_of_birth,
    policyId: match.policy_id,
    phone: match.phone,
    vehicleMake: match.vehicle_make,
    vehicleModel: match.vehicle_model,
    vehicleYear: match.vehicle_year,
    plate: match.plate,
  };
}

export function getPolicyholder(id: string): Policyholder | null {
  const row = getDb()
    .prepare("SELECT * FROM policyholders WHERE id = ?")
    .get(id) as
    | {
        id: string;
        name: string;
        date_of_birth: string;
        policy_id: string;
        phone: string;
        vehicle_make: string;
        vehicle_model: string;
        vehicle_year: string;
        plate: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    policyId: row.policy_id,
    phone: row.phone,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleYear: row.vehicle_year,
    plate: row.plate,
  };
}

export function getClausesForPolicy(policyId: string): PolicyClause[] {
  const rows = getDb()
    .prepare("SELECT * FROM policy_clauses WHERE policy_id = ?")
    .all(policyId) as Array<{
    id: string;
    policy_id: string;
    section: string;
    title: string;
    text: string;
    covers_json: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    policyId: row.policy_id,
    section: row.section,
    title: row.title,
    text: row.text,
    covers: JSON.parse(row.covers_json) as string[],
  }));
}

export function listGarages(): Garage[] {
  const rows = getDb().prepare("SELECT * FROM garages").all() as Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    supports_tow: number;
    supports_repair: number;
    supports_ev?: number;
    phone: string;
    address: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    supportsTow: Boolean(row.supports_tow),
    supportsRepair: Boolean(row.supports_repair),
    supportsEv: Boolean(row.supports_ev),
    phone: row.phone,
    address: row.address,
  }));
}

export function getGarage(id: string): Garage | null {
  return listGarages().find((g) => g.id === id) ?? null;
}
