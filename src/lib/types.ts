export type CaseStatus =
  | "intake"
  | "pending_review"
  | "approved"
  | "overridden"
  | "notified"
  | "escalated";

export type CoverageDecision = "covered" | "not_covered" | "uncertain";

export type DamageType =
  | "flat_tire"
  | "dead_battery"
  | "lockout"
  | "out_of_fuel"
  | "mechanical"
  | "collision"
  | "other";

export type DispatchAction = "tow" | "repair_truck" | "none";

export interface ExtractedFields {
  policyholderName?: string;
  dateOfBirth?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  plate?: string;
  locationLat?: number;
  locationLng?: number;
  locationText?: string;
  damageType?: DamageType;
  damageDescription?: string;
  situation?: string;
}

export interface PolicyClause {
  id: string;
  policyId: string;
  section: string;
  title: string;
  text: string;
  covers: string[];
}

export interface Policyholder {
  id: string;
  name: string;
  dateOfBirth: string;
  policyId: string;
  phone: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  plate: string;
}

export interface Garage {
  id: string;
  name: string;
  lat: number;
  lng: number;
  supportsTow: boolean;
  supportsRepair: boolean;
  phone: string;
  address: string;
}

export interface CoverageResult {
  decision: CoverageDecision;
  confidence: number;
  clauseId: string | null;
  clauseText: string | null;
  rationale: string;
}

export interface NbaResult {
  action: DispatchAction;
  garageId: string | null;
  garageName: string | null;
  distanceKm: number | null;
  rationale: string;
}

export interface CaseRecord {
  id: string;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  fields: ExtractedFields;
  transcript: string;
  redactedTranscript: string;
  identityVerified: boolean;
  policyholderId: string | null;
  policyId: string | null;
  coverage: CoverageResult | null;
  nba: NbaResult | null;
  humanDecision: CoverageDecision | null;
  humanNotes: string | null;
  smsPreview: string | null;
  flagged: boolean;
}

export interface AuditEntry {
  id: string;
  caseId: string;
  at: string;
  actor: "system" | "voice_agent" | "human_agent" | "customer";
  action: string;
  detail: Record<string, unknown>;
}
