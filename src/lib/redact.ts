import type { ExtractedFields } from "./types";

const NAME_PLACEHOLDER = "[NAME]";
const DOB_PLACEHOLDER = "[DOB]";
const PLATE_PLACEHOLDER = "[PLATE]";

/**
 * Replace personal identifiers before any redacted transcript
 * is sent to an external reasoning model.
 */
export function redactTranscript(
  transcript: string,
  fields: ExtractedFields,
): string {
  let out = transcript;

  if (fields.policyholderName) {
    out = replaceAllInsensitive(out, fields.policyholderName, NAME_PLACEHOLDER);
  }
  if (fields.dateOfBirth) {
    out = replaceAllInsensitive(out, fields.dateOfBirth, DOB_PLACEHOLDER);
    for (const variant of spokenDobVariants(fields.dateOfBirth)) {
      out = replaceAllInsensitive(out, variant, DOB_PLACEHOLDER);
    }
  }
  if (fields.plate) {
    out = replaceAllInsensitive(out, fields.plate, PLATE_PLACEHOLDER);
  }

  // Catch remaining plate-like tokens after "plate" / "license"
  out = out.replace(
    /\b(?:plate|license\s*plate)\s*[:=]?\s*[A-Z0-9-]{2,8}\b/gi,
    `plate ${PLATE_PLACEHOLDER}`,
  );

  return out;
}

function replaceAllInsensitive(
  text: string,
  search: string,
  replacement: string,
): string {
  if (!search) return text;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), replacement);
}

function spokenDobVariants(isoDate: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return [];
  const [, y, m, d] = match;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthName = months[Number(m) - 1];
  const day = String(Number(d));
  return [
    `${m}/${d}/${y}`,
    `${m}-${d}-${y}`,
    `${monthName} ${day} ${y}`,
    `${monthName} ${day}, ${y}`,
  ];
}
