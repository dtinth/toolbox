// The age tool's identity store: persistence of the single X25519 identity,
// with its secret wrapped to a WebAuthn passkey via the PRF extension. We derive
// a symmetric key from the authenticator's PRF output and AES-GCM-wrap the
// secret ourselves — we do NOT use typage's `webauthn` module, whose discoverable
// (un-pinned) assertion lets the user pick the wrong credential and fail with
// "PRF not supported". This is the seam that needs a real authenticator, so it
// can't run headless; the testable crypto lives in age-crypto.ts. See ADR-0010.
import { toRecipient } from "./age-crypto.ts";

const KEY = "age.identity.v2";

// A fixed, app-scoped PRF salt. The PRF output is HMAC(CredRandom, salt); since
// CredRandom is per-credential, one stable salt still yields a per-passkey key.
const PRF_SALT = new TextEncoder().encode("toolbox.dt.in.th/age/prf/v1");
const HKDF_INFO = new TextEncoder().encode("age identity wrap key");

export interface StoredIdentity {
  /** Relying-party id of the passkey, for the assertion. */
  rpId: string;
  /** Base64 of the passkey's credential id — pinned in `allowCredentials`. */
  credentialId: string;
  /** Public recipient (age1…) — safe in clear, used to encrypt to self. */
  recipient: string;
  /** The secret (AGE-SECRET-KEY-1…) AES-GCM-wrapped under the PRF key: base64(iv‖ct). */
  wrappedSecret: string;
}

/** How to obtain the passkey when first wrapping an identity. */
export type PasskeySource = "new" | "existing";

// Minimal shape of the PRF assertion output (lib.dom typing varies by version).
interface PrfOutputs {
  prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } };
}

// The unwrapped secret, cached in memory after one unlock for the rest of the
// session so repeated decrypts cost a single passkey ceremony.
let cachedSecret: string | null = null;

export function webauthnSupported(): boolean {
  return typeof PublicKeyCredential !== "undefined";
}

export function loadStored(): StoredIdentity | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredIdentity>;
    if (
      typeof v.rpId === "string" &&
      typeof v.credentialId === "string" &&
      typeof v.recipient === "string" &&
      typeof v.wrappedSecret === "string"
    ) {
      return {
        rpId: v.rpId,
        credentialId: v.credentialId,
        recipient: v.recipient,
        wrappedSecret: v.wrappedSecret,
      };
    }
  } catch {
    /* malformed — treat as absent */
  }
  return null;
}

export function hasIdentity(): boolean {
  return loadStored() !== null;
}

/** The stored public recipient, if any. No passkey ceremony. */
export function storedRecipient(): string | null {
  return loadStored()?.recipient ?? null;
}

const toB64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// COSE algorithm ids: ES256 then RS256 — matching the known-working PRF demos.
const pubKeyCredParams: PublicKeyCredentialParameters[] = [
  { type: "public-key", alg: -7 },
  { type: "public-key", alg: -257 },
];

/**
 * Register a discoverable, PRF-capable passkey and return its credential id
 * (base64). The name carries the recipient prefix so multiple age passkeys are
 * distinguishable in the keychain. We enable PRF here and let the first wrap's
 * `get()` be the real PRF check — WebKit under-reports `prf.enabled` at
 * registration even though PRF works at assertion (observed on iPadOS).
 */
async function createPasskey(rpId: string, recipient: string): Promise<string> {
  const keyName = `age ${recipient.slice(0, 10)}`; // e.g. "age age1q4n8r"
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: "age", id: rpId },
      user: {
        name: keyName,
        id: crypto.getRandomValues(new Uint8Array(8)),
        displayName: keyName,
      },
      pubKeyCredParams,
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required", // PRF requires UV
      },
      extensions: { prf: {} },
      challenge: crypto.getRandomValues(new Uint8Array(16)), // unused, no attestation
    },
  });
  if (!cred) throw new Error("Passkey creation was cancelled");
  return toB64((cred as PublicKeyCredential).rawId);
}

/**
 * Run a PRF assertion and turn the PRF output into an AES-GCM wrap key. When
 * `credentialId` is given the assertion is pinned to that exact credential (no
 * picker, guaranteed-PRF path); otherwise it is discoverable so the user can
 * pick an existing age passkey — and we return which one they chose.
 */
async function deriveWrapKey(
  rpId: string,
  credentialId?: string,
): Promise<{ key: CryptoKey; credentialId: string }> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId,
    userVerification: "required",
    extensions: { prf: { eval: { first: PRF_SALT } } },
  };
  if (credentialId) {
    publicKey.allowCredentials = [{ id: fromB64(credentialId), type: "public-key" }];
  }
  const cred = await navigator.credentials.get({ publicKey });
  if (!cred) throw new Error("Passkey assertion was cancelled");
  const assertion = cred as PublicKeyCredential;
  const first = (assertion.getClientExtensionResults() as PrfOutputs).prf?.results?.first;
  if (!first) {
    throw new Error(
      "This passkey returned no PRF value — pick an age passkey, or your authenticator may not support PRF",
    );
  }
  const view =
    first instanceof ArrayBuffer
      ? new Uint8Array(first)
      : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  const prf = new Uint8Array(view.length); // re-copy into an ArrayBuffer-backed array
  prf.set(view);
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: HKDF_INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, credentialId: credentialId ?? toB64(assertion.rawId) };
}

/**
 * Wrap a secret identity to the passkey and persist it. With an existing stored
 * identity we re-use its passkey (re-wrap, no new credential). Otherwise `source`
 * decides: create a fresh passkey, or pick an existing one. Caches the plaintext
 * secret for the session.
 */
export async function saveIdentity(
  identity: string,
  source: PasskeySource = "new",
): Promise<StoredIdentity> {
  const existing = loadStored();
  const rpId = existing?.rpId ?? location.hostname;
  const recipient = await toRecipient(identity);

  let wrap: { key: CryptoKey; credentialId: string };
  if (existing?.credentialId) {
    wrap = await deriveWrapKey(rpId, existing.credentialId);
  } else if (source === "existing") {
    wrap = await deriveWrapKey(rpId); // discoverable pick
  } else {
    const credentialId = await createPasskey(rpId, recipient);
    wrap = await deriveWrapKey(rpId, credentialId);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      wrap.key,
      new TextEncoder().encode(identity),
    ),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);

  const stored: StoredIdentity = {
    rpId,
    credentialId: wrap.credentialId,
    recipient,
    wrappedSecret: toB64(packed),
  };
  localStorage.setItem(KEY, JSON.stringify(stored));
  cachedSecret = identity;
  return stored;
}

/**
 * Unwrap the stored secret identity, caching it for the session. One passkey
 * ceremony (pinned to the stored credential) on the first call; subsequent calls
 * return the cached value.
 */
export async function unlockSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const stored = loadStored();
  if (!stored) throw new Error("No stored identity");
  const { key } = await deriveWrapKey(stored.rpId, stored.credentialId);
  const packed = fromB64(stored.wrappedSecret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.subarray(0, 12) },
    key,
    packed.subarray(12),
  );
  cachedSecret = new TextDecoder().decode(plain);
  return cachedSecret;
}

/** Forget the stored identity and the cached secret. */
export function clearIdentity(): void {
  localStorage.removeItem(KEY);
  cachedSecret = null;
}
