/**
 * ardhisasaService.ts
 *
 * Integration with Kenya's Ardhisasa / eCitizen Land Registry API.
 *
 * Ardhisasa (https://ardhisasa.lands.go.ke) is Kenya's official digital
 * land registry platform under the Ministry of Lands & Physical Planning.
 * It provides programmatic title deed verification via an OAuth2-protected
 * REST API.
 *
 * Environment variables:
 *   ARDHISASA_API_URL      — base URL  (default: https://api.ardhisasa.go.ke/v1)
 *   ARDHISASA_CLIENT_ID    — OAuth2 client_id issued by Ardhisasa
 *   ARDHISASA_CLIENT_SECRET — OAuth2 client_secret
 *   ARDHISASA_API_KEY      — optional static API key (some integrations use this instead)
 *
 * When credentials are absent (local dev / sandbox) the service falls back to
 * a deterministic sandbox simulation so the UI and logic can be exercised
 * without a live key.
 *
 * Exported:
 *   verifyTitleDeed(titleNumber, county?) → TitleVerificationResult
 *   isArdhisasaConfigured()              → boolean
 */

export interface TitleVerificationResult {
  /** Whether the verification call itself succeeded (API reachable + responded) */
  success: boolean;

  /** Overall trust verdict */
  status: "verified" | "not_found" | "encumbered" | "disputed" | "error" | "sandbox";

  titleNumber: string;

  /** Returned by the registry */
  registeredOwner?: string;
  parcelNumber?: string;
  registrationDate?: string;
  landUse?: string;            // "residential" | "commercial" | "agricultural" | ...
  area?: string;               // e.g. "0.0450 Ha"
  county?: string;
  locality?: string;
  encumbrances?: string[];     // e.g. ["Charge: KCB Bank Ltd", "Caveat: XYZ Court Order"]
  surveyPlan?: string;

  /** Raw response stored for audit / display */
  raw?: Record<string, any>;

  /** Human-readable message for the UI */
  message: string;

  /** ISO timestamp of the verification */
  verifiedAt: string;

  /** Whether this result came from sandbox (no real call made) */
  isSandbox: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const API_BASE =
  process.env.ARDHISASA_API_URL ?? "https://api.ardhisasa.go.ke/v1";

export function isArdhisasaConfigured(): boolean {
  return !!(
    (process.env.ARDHISASA_CLIENT_ID && process.env.ARDHISASA_CLIENT_SECRET) ||
    process.env.ARDHISASA_API_KEY
  );
}

/** Obtain a short-lived OAuth2 bearer token from Ardhisasa */
async function getAccessToken(): Promise<string> {
  const tokenUrl = `${API_BASE}/oauth/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     process.env.ARDHISASA_CLIENT_ID ?? "",
      client_secret: process.env.ARDHISASA_CLIENT_SECRET ?? "",
      scope:         "land:read",
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Ardhisasa OAuth failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data: any = await res.json();
  if (!data.access_token) throw new Error("No access_token in Ardhisasa OAuth response");
  return data.access_token;
}

// ── Sandbox simulation ────────────────────────────────────────────────────────
// Provides realistic responses for development / demo without a live API key.
// Title numbers starting with "IR" are "verified", "LR" are "encumbered",
// anything else returns "not_found" — exercising all three UI states.

const SANDBOX_COUNTIES = [
  "Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret",
  "Nyeri", "Thika", "Kitale", "Meru", "Garissa",
];
const SANDBOX_OWNERS = [
  "Wanjiru Holdings Ltd", "Kamau & Associates", "Otieno Family Trust",
  "Kariuki Real Estate", "Nyambura Investments Ltd", "Mwangi Properties",
  "Achieng Development Co.", "Mutua Land Holdings",
];
const SANDBOX_USES = ["Residential", "Commercial", "Mixed Use", "Agricultural"];

function sandboxResult(titleNumber: string): TitleVerificationResult {
  const upper = titleNumber.trim().toUpperCase();
  const seed  = upper.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const pick  = <T>(arr: T[]) => arr[seed % arr.length];

  const verifiedAt = new Date().toISOString();

  if (upper.startsWith("IR") || upper.startsWith("GR")) {
    return {
      success: true, isSandbox: true, status: "verified",
      titleNumber,
      registeredOwner: pick(SANDBOX_OWNERS),
      parcelNumber: `L.R. ${Math.floor(seed % 9000) + 1000}/${(seed % 99) + 1}`,
      registrationDate: `${2000 + (seed % 23)}-${String((seed % 12) + 1).padStart(2, "0")}-${String((seed % 28) + 1).padStart(2, "0")}`,
      landUse: pick(SANDBOX_USES),
      area: `${(((seed % 900) + 100) / 10000).toFixed(4)} Ha`,
      county: pick(SANDBOX_COUNTIES),
      locality: "Westlands Sub-County",
      encumbrances: [],
      surveyPlan: `SP-${Math.floor(seed % 99000) + 10000}`,
      raw: { sandbox: true, titleNumber },
      message: `[SANDBOX] Title ${titleNumber} verified — registered and unencumbered.`,
      verifiedAt,
    };
  }

  if (upper.startsWith("LR") || upper.startsWith("CR")) {
    return {
      success: true, isSandbox: true, status: "encumbered",
      titleNumber,
      registeredOwner: pick(SANDBOX_OWNERS),
      parcelNumber: `L.R. ${Math.floor(seed % 9000) + 1000}/${(seed % 99) + 1}`,
      registrationDate: `${2000 + (seed % 23)}-${String((seed % 12) + 1).padStart(2, "0")}-01`,
      landUse: pick(SANDBOX_USES),
      area: `${(((seed % 900) + 100) / 10000).toFixed(4)} Ha`,
      county: pick(SANDBOX_COUNTIES),
      locality: "Kilimani",
      encumbrances: ["Charge: Equity Bank Ltd", "Caveat: High Court MISC 234/2023"],
      raw: { sandbox: true, titleNumber },
      message: `[SANDBOX] Title ${titleNumber} found but has active charges/caveats.`,
      verifiedAt,
    };
  }

  return {
    success: true, isSandbox: true, status: "not_found",
    titleNumber,
    message: `[SANDBOX] Title number ${titleNumber} not found in the registry. Prefix with IR… for a verified result or LR… for encumbered.`,
    verifiedAt,
  };
}

// ── Live API call ─────────────────────────────────────────────────────────────

async function liveLookup(titleNumber: string, county?: string): Promise<TitleVerificationResult> {
  const verifiedAt = new Date().toISOString();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept":       "application/json",
    };

    // Support both OAuth2 and static API key auth
    if (process.env.ARDHISASA_API_KEY) {
      headers["X-API-Key"] = process.env.ARDHISASA_API_KEY;
    } else {
      const token = await getAccessToken();
      headers["Authorization"] = `Bearer ${token}`;
    }

    const params = new URLSearchParams({ titleNumber });
    if (county) params.append("county", county);

    const res = await fetch(`${API_BASE}/titles/verify?${params}`, {
      method:  "GET",
      headers,
      signal:  AbortSignal.timeout(15_000), // 15s timeout
    });

    const raw = await res.json().catch(() => ({}));

    if (res.status === 404 || raw?.status === "not_found") {
      return {
        success: true, isSandbox: false, status: "not_found",
        titleNumber, raw,
        message: `Title number ${titleNumber} was not found in the Ardhisasa land registry.`,
        verifiedAt,
      };
    }

    if (!res.ok) {
      throw new Error(`Ardhisasa API error ${res.status}: ${raw?.message ?? res.statusText}`);
    }

    // Map the Ardhisasa response shape to our normalised result
    // (Ardhisasa response fields per their API docs — adjust if the schema changes)
    const encumbrances: string[] = [
      ...(raw.charges ?? []).map((c: any) => `Charge: ${c.chargee ?? c.name}`),
      ...(raw.caveats ?? []).map((c: any) => `Caveat: ${c.description ?? c.reference}`),
      ...(raw.cautions ?? []).map((c: any) => `Caution: ${c.description ?? c.reference}`),
    ];

    const status: TitleVerificationResult["status"] =
      raw.status === "disputed" ? "disputed" :
      encumbrances.length > 0  ? "encumbered" :
      raw.isValid || raw.registered ? "verified" :
      "not_found";

    return {
      success: true, isSandbox: false, status,
      titleNumber,
      registeredOwner:   raw.registeredOwner ?? raw.owner ?? raw.ownerName,
      parcelNumber:      raw.parcelNumber ?? raw.lrNumber,
      registrationDate:  raw.registrationDate ?? raw.dateRegistered,
      landUse:           raw.landUse ?? raw.use,
      area:              raw.area ?? raw.landSize,
      county:            raw.county ?? raw.countyName,
      locality:          raw.locality ?? raw.location,
      encumbrances,
      surveyPlan:        raw.surveyPlanNumber ?? raw.surveyPlan,
      raw,
      message:
        status === "verified"   ? `Title ${titleNumber} is registered and unencumbered.` :
        status === "encumbered" ? `Title ${titleNumber} is registered but has active charges/caveats.` :
        status === "disputed"   ? `Title ${titleNumber} is under dispute — exercise caution.` :
                                  `Title ${titleNumber} could not be verified.`,
      verifiedAt,
    };
  } catch (err: any) {
    // Network errors, timeouts, etc. — don't crash, return a graceful error result
    return {
      success: false, isSandbox: false, status: "error",
      titleNumber,
      message: `Verification failed: ${err.message}`,
      verifiedAt,
    };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify a Kenya title deed number against Ardhisasa.
 * Falls back to sandbox simulation when credentials are not configured.
 */
export async function verifyTitleDeed(
  titleNumber: string,
  county?: string,
): Promise<TitleVerificationResult> {
  const normalized = titleNumber.trim().toUpperCase().replace(/\s+/g, " ");

  if (!normalized) {
    return {
      success: false, isSandbox: false, status: "error",
      titleNumber: titleNumber,
      message: "Title number cannot be empty.",
      verifiedAt: new Date().toISOString(),
    };
  }

  if (!isArdhisasaConfigured()) {
    console.log(`[Ardhisasa] Running in sandbox mode (no API credentials configured)`);
    return sandboxResult(normalized);
  }

  return liveLookup(normalized, county);
}
