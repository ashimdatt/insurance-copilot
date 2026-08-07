/**
 * Upsert policyholders, clauses, and garages from data/*.json into copilot.db.
 * Run after editing JSON on a machine that already has a DB:
 *   npm run sync-seed
 */
import {
  syncSeedFromJson,
  listGarages,
  getClausesForPolicy,
  getPolicyholder,
} from "../src/lib/db";

syncSeedFromJson();
const garages = listGarages();
const evGarages = garages.filter((g) => g.supportsEv);
const evClauses = getClausesForPolicy("POL-RSA-EV-001");
const ashim = getPolicyholder("PH-005");

console.log(
  `Synced seed data. Garages: ${garages.length} (${evGarages.length} EV). EV policy clauses: ${evClauses.length}.`,
);
console.log(
  `Ashim Datta policy: ${ashim?.policyId ?? "missing"} · ${ashim?.vehicleMake} ${ashim?.vehicleModel}`,
);
