import { describe, expect, it } from "vite-plus/test";
import {
  decryptBytes,
  decryptedName,
  encryptBytes,
  encryptedName,
  generateIdentity,
  isArmored,
  looksLikeAge,
  toRecipient,
} from "./age-crypto.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("age-crypto", () => {
  it("round-trips bytes through encrypt and decrypt with an X25519 keypair", async () => {
    const id = await generateIdentity();
    const recipient = await toRecipient(id);
    const plaintext = bytes("hello age 🦈");

    const ciphertext = await encryptBytes([recipient], plaintext);
    const out = await decryptBytes([id], ciphertext);

    expect(text(out)).toBe("hello age 🦈");
  });

  it("derives an age1 recipient from an AGE-SECRET-KEY identity", async () => {
    const id = await generateIdentity();
    expect(id.startsWith("AGE-SECRET-KEY-1")).toBe(true);
    const recipient = await toRecipient(id);
    expect(recipient.startsWith("age1")).toBe(true);
  });

  it("produces ASCII armor when asked, and round-trips it", async () => {
    const id = await generateIdentity();
    const recipient = await toRecipient(id);

    const armored = await encryptBytes([recipient], bytes("armored payload"), { armor: true });
    expect(text(armored)).toContain("-----BEGIN AGE ENCRYPTED FILE-----");
    expect(isArmored(armored)).toBe(true);

    // decrypt auto-detects and decodes the armor
    const out = await decryptBytes([id], armored);
    expect(text(out)).toBe("armored payload");
  });

  it("binary ciphertext is not armored but still looks like age", async () => {
    const id = await generateIdentity();
    const recipient = await toRecipient(id);
    const ciphertext = await encryptBytes([recipient], bytes("x"));
    expect(isArmored(ciphertext)).toBe(false);
    expect(looksLikeAge(ciphertext)).toBe(true);
  });

  it("plain (non-age) bytes are not recognised as age", () => {
    expect(looksLikeAge(bytes("just a normal file"))).toBe(false);
    expect(isArmored(bytes("just a normal file"))).toBe(false);
  });

  it("decrypts with any of several identities (wrong one ignored)", async () => {
    const right = await generateIdentity();
    const wrong = await generateIdentity();
    const recipient = await toRecipient(right);
    const ciphertext = await encryptBytes([recipient], bytes("multi"));
    const out = await decryptBytes([wrong, right], ciphertext);
    expect(text(out)).toBe("multi");
  });

  it("fails to decrypt with the wrong identity", async () => {
    const right = await generateIdentity();
    const wrong = await generateIdentity();
    const recipient = await toRecipient(right);
    const ciphertext = await encryptBytes([recipient], bytes("secret"));
    await expect(decryptBytes([wrong], ciphertext)).rejects.toThrow();
  });

  it("rejects encrypt with no recipients and decrypt with no identities", async () => {
    await expect(encryptBytes([], bytes("x"))).rejects.toThrow(/recipient/i);
    await expect(decryptBytes([], bytes("x"))).rejects.toThrow(/identit/i);
  });

  it("names encrypted and decrypted files", () => {
    expect(encryptedName("photo.png")).toBe("photo.png.age");
    expect(decryptedName("photo.png.age")).toBe("photo.png");
    expect(decryptedName("nodotage")).toBe("nodotage.dec");
  });
});
