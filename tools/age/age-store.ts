// The age tool's identity store: persistence of the single X25519 identity,
// with its secret wrapped to a WebAuthn passkey (typage's PRF-derived recipient).
// This is the seam that needs a real authenticator, so it can't run headless —
// it is kept thin and free of business logic; the testable crypto is in
// age-crypto.ts. See ADR-0010.
import * as age from "age-encryption";
import { toRecipient } from "./age-crypto.ts";

const KEY = "age.identity.v1";

export interface StoredIdentity {
  /** Non-secret passkey handle from createCredential (AGE-PLUGIN-FIDO2PRF-1…). */
  passkey: string;
  /** Public recipient (age1…) — safe in clear, used to encrypt to self. */
  recipient: string;
  /** The secret (AGE-SECRET-KEY-1…), age-armored and encrypted to the passkey. */
  wrappedSecret: string;
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
      typeof v.passkey === "string" &&
      typeof v.recipient === "string" &&
      typeof v.wrappedSecret === "string"
    ) {
      return { passkey: v.passkey, recipient: v.recipient, wrappedSecret: v.wrappedSecret };
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

/** Create a passkey credential for wrapping. One passkey ceremony (create). */
export function setupPasskey(keyName = "age identity 🔐"): Promise<string> {
  return age.webauthn.createCredential({ keyName });
}

/**
 * Wrap a secret identity to the passkey and persist it (creating the passkey on
 * first use). Returns the stored entry and caches the plaintext secret for the
 * session. Costs one passkey ceremony to wrap (plus one to create, first time).
 */
export async function saveIdentity(identity: string): Promise<StoredIdentity> {
  const passkey = loadStored()?.passkey ?? (await setupPasskey());
  const recipient = await toRecipient(identity);
  const e = new age.Encrypter();
  e.addRecipient(new age.webauthn.WebAuthnRecipient({ identity: passkey }));
  const ciphertext = await e.encrypt(identity);
  const stored: StoredIdentity = {
    passkey,
    recipient,
    wrappedSecret: age.armor.encode(ciphertext),
  };
  localStorage.setItem(KEY, JSON.stringify(stored));
  cachedSecret = identity;
  return stored;
}

/**
 * Unwrap the stored secret identity, caching it for the session. One passkey
 * ceremony on the first call; subsequent calls return the cached value.
 */
export async function unlockSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const stored = loadStored();
  if (!stored) throw new Error("No stored identity");
  const d = new age.Decrypter();
  d.addIdentity(new age.webauthn.WebAuthnIdentity({ identity: stored.passkey }));
  cachedSecret = await d.decrypt(age.armor.decode(stored.wrappedSecret), "text");
  return cachedSecret;
}

/** Forget the stored identity and the cached secret. */
export function clearIdentity(): void {
  localStorage.removeItem(KEY);
  cachedSecret = null;
}
