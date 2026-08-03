# Insurance Co-Pilot

Roadside assistance intake, coverage check, and dispatch recommendation with human approval.

Prototype of the architecture in `docs/architecture.pdf` and `docs/PRD_Insurance_CoPilot_v2.pdf`.

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
| Audit log | Implemented |

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
2. Use a demo identity, for example `Jordan Lee` / `1988-04-12`.
3. Share GPS (optional), describe the problem, finish intake.
4. **Agent dashboard** (`/dashboard`): review citation + NBA, approve or override.
5. Simulated SMS appears on the case after approval.

## Environment

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Realtime voice + default coverage/text LLM |
| `ANTHROPIC_API_KEY` | Optional coverage/text LLM |
| `LLM_PROVIDER` | `openai` (default) or `anthropic` |
| `OPENAI_MODEL` | Chat model for coverage/text |
| `OPENAI_REALTIME_MODEL` | Realtime voice model (default `gpt-realtime`) |
| `ANTHROPIC_MODEL` | Anthropic model when provider is anthropic |

Keys stay in `.env` (gitignored). Never commit secrets.

## Demo data

Synthetic SQLite DB is created at `data/copilot.db` on first API use, seeded from:

- `data/policyholders.json`
- `data/policies.json`
- `data/garages.json`

## Architecture (prototype)

```
Browser voice/text client
  → Orchestrator (session, tools, confidence routing)
  → Identity check (local DB)
  → PII redaction
  → Coverage LLM (redacted transcript + retrieved clauses)
  → Garage lookup
  → Agent dashboard (approve / override)
  → Simulated SMS + audit log
```

Guardrail from the PRD: no coverage discussion on the voice channel; no customer notification without human approval; no citation means escalate.

## Scripts

```bash
npm run dev      # local development
npm run build    # production build
npm run start    # run production server
npm run lint     # eslint
```
