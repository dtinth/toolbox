// The age tool's crypto core: thin, testable wrappers over the `age-encryption`
// (typage) library. X25519 recipients/identities only — no passphrases, no
// WebAuthn (the passkey wrapping lives in age-store.ts, which can't run
// headless). Everything here is plain async crypto over bytes, exercised by
// age-crypto.test.ts with real keys. See ADR-0010.
import * as age from "age-encryption";

export { generateIdentity } from "age-encryption";

const ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";
const BINARY_MAGIC = "age-encryption.org/v1";

/** Derive the public recipient (`age1…`) from a secret identity. */
export function toRecipient(identity: string): Promise<string> {
  return age.identityToRecipient(identity);
}

/**
 * Encrypt `data` to one or more recipients (`age1…`). With `armor`, the result
 * is the UTF-8 bytes of the ASCII-armored (PEM) ciphertext; otherwise it is the
 * binary age format.
 */
export async function encryptBytes(
  recipients: string[],
  data: Uint8Array,
  opts: { armor?: boolean } = {},
): Promise<Uint8Array> {
  if (recipients.length === 0) {
    throw new Error("No recipients to encrypt to");
  }
  const e = new age.Encrypter();
  for (const r of recipients) {
    e.addRecipient(r);
  }
  const ciphertext = await e.encrypt(data);
  if (opts.armor === true) {
    return new TextEncoder().encode(age.armor.encode(ciphertext));
  }
  return ciphertext;
}

/**
 * Decrypt `data` with one or more identities (`AGE-SECRET-KEY-1…`). Armored and
 * binary ciphertext are both accepted — armor is detected and decoded first.
 */
export async function decryptBytes(identities: string[], data: Uint8Array): Promise<Uint8Array> {
  if (identities.length === 0) {
    throw new Error("No identities to decrypt with");
  }
  const binary = isArmored(data) ? age.armor.decode(new TextDecoder().decode(data)) : data;
  const d = new age.Decrypter();
  for (const i of identities) {
    d.addIdentity(i);
  }
  // Bind the await to a temp (rather than `return await`): keeps `require-await`
  // satisfied without tripping `return-await` outside a try.
  const plaintext = await d.decrypt(binary);
  return plaintext;
}

/** Whether `data` is ASCII-armored age ciphertext (begins with the PEM header). */
export function isArmored(data: Uint8Array): boolean {
  return decodeStart(data, ARMOR_HEADER.length).startsWith(ARMOR_HEADER);
}

/** Whether `data` looks like age ciphertext at all (armored or binary). */
export function looksLikeAge(data: Uint8Array): boolean {
  if (isArmored(data)) {
    return true;
  }
  return decodeStart(data, BINARY_MAGIC.length).startsWith(BINARY_MAGIC);
}

function decodeStart(data: Uint8Array, length: number): string {
  return new TextDecoder().decode(data.subarray(0, length));
}

/** Output name for an encrypted file: append `.age`. */
export function encryptedName(name: string): string {
  return `${name || "blob"}.age`;
}

/** Output name for a decrypted file: strip a trailing `.age`, else append `.dec`. */
export function decryptedName(name: string): string {
  if (name.endsWith(".age") && name.length > 4) {
    return name.slice(0, -4);
  }
  return `${name || "blob"}.dec`;
}
