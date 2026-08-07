# Insurance Co-Pilot

Roadside assistance intake, coverage check, and dispatch recommendation with human approval.

Prototype of the architecture in `docs/architecture.pdf` and `docs/PRD_Insurance_CoPilot_v2.pdf`.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (app source is `.ts` / `.tsx`) |
| Runtime | Node.js (Next.js server APIs + SQLite) |
| Framework | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS |
| Data | SQLite via `better-sqlite3`, seeded from JSON in `data/` |
| Voice | OpenAI Realtime API (WebRTC in the browser) |
| Coverage / text LLM | OpenAI chat (default) or Anthropic (`LLM_PROVIDER`) |
| Validation | Zod |
| Audit | Append-only SQLite `audit_log` with SHA-256 hash chain |

There is no separate Python/Java backend. Frontend and API routes live in one Next.js TypeScript app.

## What works in this repo

| Feature | Status |
|---|---|
| F1 Voice intake (OpenAI Realtime WebRTC) | Implemented |
| F1 Text intake fallback | Implemented |
| Identity check (name + DOB → synthetic policyholders) | Implemented |
| PII redaction before external reasoning | Implemented |
| F2 Coverage check with clause citation | Implemented (LLM + rule fallback) |
| F3 Next best action (tow vs repair, nearest garage) | Implemented |
| F4 Agent observation dashboard | Implemented |
| F5 Simulated SMS on approval | Implemented |
| Append-only hash-chained audit trail | Implemented |

## Quick start

```bash
# Create a local .env (not committed) with at least:
# OPENAI_API_KEY=...
# optional: ANTHROPIC_API_KEY=...  LLM_PROVIDER=openai|anthropic
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. **Voice intake** (`/voice`): start a call, or use text fallback.
2. Use a demo identity, for example `Ashim Datta` / `1965-03-07`.
3. Share GPS (optional), describe the problem, finish intake.
4. **Agent dashboard** (`/dashboard`): review citation + NBA, approve or override.
5. Simulated SMS appears on the case after approval. Expand audit events and click **Verify chain**.

## Environment

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Realtime voice + default coverage/text LLM |
| `ANTHROPIC_API_KEY` | Optional coverage/text LLM |
| `LLM_PROVIDER` | `openai` (default) or `anthropic` |
| `OPENAI_MODEL` | Chat model for coverage/text |
| `OPENAI_REALTIME_MODEL` | Realtime voice model |
| `ANTHROPIC_MODEL` | Anthropic model when provider is anthropic |
| `DEFAULT_AGENT_ID` | Fallback human agent id on approve/override |

Keys stay in `.env` (gitignored). Never commit secrets.

## Demo data

Synthetic SQLite DB is created at `data/copilot.db` on first API use, seeded from:

- `data/policyholders.json`
- `data/policies.json` (includes **EV Roadside** `POL-RSA-EV-001`)
- `data/garages.json` (includes EV flatbed / mobile charge providers)

If you edit those JSON files on a machine that already has `copilot.db`, re-apply with:

```bash
npm run sync-seed
```

Tesla and other EV cases prefer `supportsEv` garages for dispatch.

## Architecture (prototype)

```
Browser voice/text client
  → Orchestrator (session, tools, confidence routing)
  → Identity check (local DB)
  → PII redaction
  → Coverage LLM (redacted transcript + retrieved clauses)
  → Garage lookup
  → Agent dashboard (approve / override)
  → Simulated SMS + append-only audit log
```

Guardrail from the PRD: no coverage discussion on the voice channel; no customer notification without human approval; no citation means escalate.

## Traceability

Every material step writes an **append-only** row to `audit_log` with:

- Per-case `seq`
- `actor` + `actor_id` (human approvals require an agent id)
- Full `detail_json` (field before/after, redacted transcript, retrieved clauses, model prompt/response, coverage, NBA, SMS)
- SHA-256 hash chain: `prev_hash` → `entry_hash`

SQLite triggers reject `UPDATE` / `DELETE` on `audit_log`. Verify with:

```bash
curl -s http://localhost:3000/api/cases/CASE-XXXXXXXX/audit | jq .verification
```

Or use **Verify chain** on the case page.

Logged actions include: `case_created`, `fields_updated`, `transcript_appended`, `identity_verified` / `identity_failed`, `pii_redaction`, `analysis_started`, `policy_retrieval`, `coverage_model_call`, `coverage_decision`, `nba_recommendation`, `analysis_complete`, `escalated`, `approved` / `overridden`, `sms_simulated`.

Still local-file SQLite (not WORM cloud storage). Treat this as strong prototype accountability; production would mirror events to immutable object storage / SIEM.

## Database schema (`data/copilot.db`)

### `policyholders`

| Column | Type | Example |
|---|---|---|
| `id` | TEXT PK | `PH-005` |
| `name` | TEXT | `Ashim Datta` |
| `date_of_birth` | TEXT | `1965-03-07` |
| `policy_id` | TEXT | `POL-RSA-EV-001` |
| `phone` | TEXT | `+16506567633` |
| `vehicle_make` | TEXT | `Tesla` |
| `vehicle_model` | TEXT | `Model Y` |
| `vehicle_year` | TEXT | `2023` |
| `plate` | TEXT | `ASHIM1` |

### `policy_clauses`

| Column | Type | Example |
|---|---|---|
| `id` | TEXT PK | `CL-201` |
| `policy_id` | TEXT | `POL-RSA-EV-001` |
| `section` | TEXT | `2.1` |
| `title` | TEXT | `Mobile charging for depleted traction battery` |
| `text` | TEXT | `Covered when a BEV or PHEV...` |
| `covers_json` | TEXT | `["out_of_fuel","dead_battery"]` |

### `garages`

| Column | Type | Example |
|---|---|---|
| `id` | TEXT PK | `GAR-EV-001` |
| `name` | TEXT | `SF EV Flatbed & Charge Assist` |
| `lat` / `lng` | REAL | `37.7695` / `-122.4101` |
| `supports_tow` | INTEGER 0/1 | `1` |
| `supports_repair` | INTEGER 0/1 | `1` |
| `supports_ev` | INTEGER 0/1 | `1` |
| `phone` | TEXT | `+15550201001` |
| `address` | TEXT | `850 Harrison St, San Francisco, CA` |

### `cases` (mutable current state)

| Column | Type | Example |
|---|---|---|
| `id` | TEXT PK | `CASE-87FDF2AD` |
| `status` | TEXT | `pending_review` / `notified` |
| `created_at` / `updated_at` | TEXT ISO | `2026-08-07T17:00:00.000Z` |
| `fields_json` | TEXT | `{"policyholderName":"Ashim Datta","damageType":"out_of_fuel",...}` |
| `transcript` | TEXT | raw intake text |
| `redacted_transcript` | TEXT | names/DOB/plates replaced |
| `identity_verified` | INTEGER 0/1 | `1` |
| `policyholder_id` | TEXT | `PH-005` |
| `policy_id` | TEXT | `POL-RSA-EV-001` |
| `coverage_json` | TEXT | `{"decision":"covered","confidence":0.9,"clauseId":"CL-201",...}` |
| `nba_json` | TEXT | `{"action":"repair_truck","garageId":"GAR-EV-001",...}` |
| `human_decision` | TEXT | `covered` |
| `human_notes` | TEXT | `Looks correct` |
| `sms_preview` | TEXT | `Hi Ashim, good news: your roadside assistance request is approved...` |
| `flagged` | INTEGER 0/1 | `0` |

### `audit_log` (append-only)

| Column | Type | Example |
|---|---|---|
| `id` | TEXT PK | UUID |
| `case_id` | TEXT | `CASE-87FDF2AD` |
| `seq` | INTEGER | `1`, `2`, `3`… per case |
| `at` | TEXT ISO | `2026-08-07T17:01:12.345Z` |
| `actor` | TEXT | `system` / `voice_agent` / `human_agent` |
| `actor_id` | TEXT | `system` or `agent-demo-001` |
| `action` | TEXT | `coverage_decision` |
| `correlation_id` | TEXT | usually same as `case_id` |
| `detail_json` | TEXT | event payload (prompt, clauses, decisions, …) |
| `prev_hash` | TEXT | prior `entry_hash` or genesis zeros |
| `entry_hash` | TEXT | SHA-256 of canonical event fields |

Example `detail_json` for `coverage_model_call`:

```json
{
  "method": "rules",
  "provider": null,
  "model": null,
  "prompt": "You are an insurance coverage analyst...",
  "rawResponse": null
}
```

Example for `approved`:

```json
{
  "acceptSuggestion": true,
  "suggestedDecision": "covered",
  "humanDecision": "covered",
  "priorCoverage": { "decision": "covered", "clauseId": "CL-201", "confidence": 0.78 },
  "priorNba": { "action": "repair_truck", "garageId": "GAR-EV-001" },
  "notes": null,
  "overrideNba": null
}
```

### Debug queries

```bash
sqlite3 data/copilot.db "SELECT seq, at, actor, actor_id, action, substr(entry_hash,1,12) FROM audit_log WHERE case_id='CASE-XXXXXXXX' ORDER BY seq;"

sqlite3 data/copilot.db "SELECT id, name, policy_id, vehicle_make, vehicle_model FROM policyholders;"

sqlite3 data/copilot.db "SELECT id, decision FROM (SELECT id, json_extract(coverage_json,'$.decision') AS decision FROM cases);"
```

## Scripts

```bash
npm run dev        # local development
npm run build      # production build
npm run start      # run production server
npm run lint       # eslint
npm run sync-seed  # upsert JSON seed data into copilot.db
```
