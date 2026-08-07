import type { DamageType, DispatchAction, Garage, NbaResult } from "./types";
import { listGarages } from "./db";

const TOW_DAMAGE: DamageType[] = ["mechanical", "collision", "other"];
const REPAIR_DAMAGE: DamageType[] = [
  "flat_tire",
  "dead_battery",
  "lockout",
  "out_of_fuel",
];

const EV_MAKES = new Set([
  "tesla",
  "rivian",
  "lucid",
  "polestar",
  "vinfast",
]);

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

export function isElectricVehicle(input: {
  vehicleMake?: string;
  vehicleModel?: string;
}): boolean {
  const make = (input.vehicleMake || "").trim().toLowerCase();
  if (make && EV_MAKES.has(make)) return true;
  const model = (input.vehicleModel || "").toLowerCase();
  return /\b(model\s*[3sxy]|cybertruck|leaf|bolt|ioniq|mach-?e|id\.?\s*4|ev\b)/i.test(
    `${make} ${model}`,
  );
}

export function recommendDispatch(input: {
  damageType?: DamageType;
  locationLat?: number;
  locationLng?: number;
  vehicleMake?: string;
  vehicleModel?: string;
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

  // Depleted EV charge: prefer mobile charge / EV repair when possible;
  // mechanical EV faults still tow via EV flatbed shops.
  const wantsEv = isElectricVehicle(input);
  if (wantsEv && damageType === "out_of_fuel") {
    action = "repair_truck";
  }

  const lat = input.locationLat ?? 37.7749;
  const lng = input.locationLng ?? -122.4194;
  const usedDefaultLocation =
    input.locationLat === undefined || input.locationLng === undefined;

  let candidates = listGarages().filter((g) =>
    action === "tow" ? g.supportsTow : g.supportsRepair,
  );

  if (wantsEv) {
    const evCapable = candidates.filter((g) => g.supportsEv);
    if (evCapable.length > 0) candidates = evCapable;
  }

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
    rationale: `Damage type "${damageType}" maps to ${action}${
      wantsEv ? " (EV-capable provider preferred)" : ""
    }. Nearest eligible garage is ${best.name} (${best.address})${
      usedDefaultLocation
        ? " using default SF coordinates because GPS was not shared"
        : ""
    }.`,
  };
}
