import type { DamageType, DispatchAction, Garage, NbaResult } from "./types";
import { listGarages } from "./db";

const TOW_DAMAGE: DamageType[] = ["mechanical", "collision", "other"];
const REPAIR_DAMAGE: DamageType[] = [
  "flat_tire",
  "dead_battery",
  "lockout",
  "out_of_fuel",
];

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function recommendDispatch(input: {
  damageType?: DamageType;
  locationLat?: number;
  locationLng?: number;
}): NbaResult {
  const damageType = input.damageType;
  if (!damageType) {
    return {
      action: "none",
      garageId: null,
      garageName: null,
      distanceKm: null,
      rationale: "Damage type not yet known; cannot recommend dispatch.",
    };
  }

  let action: DispatchAction;
  if (TOW_DAMAGE.includes(damageType)) {
    action = "tow";
  } else if (REPAIR_DAMAGE.includes(damageType)) {
    action = "repair_truck";
  } else {
    action = "none";
  }

  const lat = input.locationLat ?? 37.7749;
  const lng = input.locationLng ?? -122.4194;
  const usedDefaultLocation =
    input.locationLat === undefined || input.locationLng === undefined;

  const candidates = listGarages().filter((g) =>
    action === "tow" ? g.supportsTow : g.supportsRepair,
  );

  if (candidates.length === 0 || action === "none") {
    return {
      action,
      garageId: null,
      garageName: null,
      distanceKm: null,
      rationale: `Recommended action is ${action}, but no matching garage was found.`,
    };
  }

  let best: Garage = candidates[0];
  let bestDistance = haversineKm(lat, lng, best.lat, best.lng);
  for (const garage of candidates.slice(1)) {
    const d = haversineKm(lat, lng, garage.lat, garage.lng);
    if (d < bestDistance) {
      best = garage;
      bestDistance = d;
    }
  }

  return {
    action,
    garageId: best.id,
    garageName: best.name,
    distanceKm: Math.round(bestDistance * 10) / 10,
    rationale: `Damage type "${damageType}" maps to ${action}. Nearest eligible garage is ${best.name} (${best.address})${
      usedDefaultLocation
        ? " using default SF coordinates because GPS was not shared"
        : ""
    }.`,
  };
}
