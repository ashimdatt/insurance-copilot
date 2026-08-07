/**
 * Format E.164 / digits for natural spoken or SMS copy.
 * Example: +16506567633 → "650-656-7633"
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const national =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : digits;
  if (national.length !== 10) return phone;
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
}

/** Spoken form for voice TTS, e.g. "six five zero, six five six, seven six three three" */
export function formatPhoneForSpeech(phone: string | null | undefined): string {
  const display = formatPhoneDisplay(phone);
  if (!/^\d{3}-\d{3}-\d{4}$/.test(display)) {
    return display || "the mobile number on your policy";
  }
  const digitWords = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ];
  const say = (chunk: string) =>
    chunk
      .split("")
      .map((d) => digitWords[Number(d)] ?? d)
      .join(" ");
  const [a, b, c] = display.split("-");
  return `${say(a)}, ${say(b)}, ${say(c)}`;
}

export function buildIntakeClosingScript(input: {
  firstName?: string;
  phone?: string | null;
  escalate?: boolean;
  identityVerified?: boolean;
}): string {
  const name = input.firstName?.trim().split(/\s+/)[0] || "there";
  const phoneDisplay = formatPhoneDisplay(input.phone);
  const phoneSpeech = formatPhoneForSpeech(input.phone);

  if (input.escalate && !input.identityVerified) {
    return `Thanks ${name}. I wasn't able to match your details to a policy on this call, so I'm connecting you with a human agent and ending this automated call now. They'll help verify your account and discuss next steps shortly. Please keep your phone nearby. Goodbye.`;
  }

  const phoneClause = phoneDisplay
    ? `We'll text an update with next steps to ${phoneSpeech} (that's ${phoneDisplay}) within one minute.`
    : `We'll text an update with next steps to the mobile number on your policy within one minute.`;

  if (input.escalate) {
    return `Thanks ${name}. I'm connecting you with a human agent and ending this automated call now. ${phoneClause} Stay safe.`;
  }

  return `Thanks ${name}, I've got everything confirmed. I'm going to disconnect this call now. ${phoneClause} Please keep an eye on your phone. Goodbye.`;
}
