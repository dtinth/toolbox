# 0010: The age tool stores one X25519 identity whose secret is wrapped to a WebAuthn passkey

The **age** tool encrypts and decrypts **Blob**s with [age](https://age-encryption.org/)
(via the `age-encryption` / typage library, bundled into the tool). It uses age's
**X25519 recipients/identities**, not passphrases. The user has exactly one
stored **identity** (a keypair). Its public **recipient** (`age1…`) is persisted
in clear; its secret (`AGE-SECRET-KEY-1…`) is persisted only **age-encrypted to a
WebAuthn passkey** (the typage `webauthn` module's PRF-derived recipient). The
plaintext secret never touches durable storage.

Persisted (localStorage), all non-secret or already-encrypted:

```
{
  rpId:          "host.example",             // relying-party id of the passkey
  recipient:     "age1…",                    // public, for encrypt-to-self
  wrappedSecret: "<age armored ciphertext>"  // the secret, encrypted to the passkey
}
```

The plaintext secret exists only in memory, after an **unlock**: one
`navigator.credentials.get()` ceremony (a passkey touch / user verification)
decrypts `wrappedSecret` and adds the identity to the `Decrypter` for the rest of
the session.

## Why

- **Keypairs over passphrase, by request.** Asymmetric keys let the user encrypt
  for future-self and (via a pasted recipient) for others, and stay interoperable
  with the `age` CLI — a portable `AGE-SECRET-KEY-1…` the user can copy out.
- **A secret key must not sit in plaintext localStorage.** Any script on the
  origin can read localStorage; a bare secret there is the weakest at-rest
  posture. Wrapping it so that unwrapping requires a hardware/biometric ceremony
  raises the bar to "attacker also needs a live passkey assertion."
- **WebAuthn PRF is symmetric and key-material-free.** typage's `WebAuthnRecipient`
  / `WebAuthnIdentity` derive a symmetric key from the authenticator's PRF output
  for a per-message nonce; there is no extra secret to store or lose. We persist
  only the non-secret `rpId` and use a **discoverable** credential, so wrap/unwrap
  are plain `get()` assertions the user confirms.
- **We create the passkey ourselves, not via typage's `createCredential`.** That
  helper rejects unless `getClientExtensionResults().prf.enabled` is true at
  _registration_ — but WebKit (every browser on iPad) doesn't report that flag at
  registration even though PRF works at _assertion_, so the gate is a false
  negative there (observed live on Safari/iPadOS). We register the credential with
  the PRF extension directly and let the first wrap (`get()`) be the real PRF
  check. Because the toolbox origin hosts no login passkeys, a discoverable pick
  for this `rpId` surfaces only age passkeys, so dropping the pinned-credential
  handle costs no practical safety.
- **Wrap the secret, don't make the passkey the identity.** The alternative —
  encrypting blobs directly to a `WebAuthnRecipient` — would bind every ciphertext
  to that one authenticator: not decryptable by the `age` CLI, not portable, not
  usable to encrypt for a third party. Wrapping keeps a normal, portable X25519
  identity and uses the passkey only as an at-rest lock on its secret.
- **Touch only when a secret is needed.** Encrypting a blob targets the public
  X25519 recipient and never touches the passkey (0 ceremonies). Only operations
  that need the _secret_ — decrypt, "Copy secret key", and re-wrapping on
  generate/import — cost one ceremony. Because there is a single identity wrapped
  as a single blob, unlock is one touch per session, not one per key.

## Trade-offs accepted

- **Lose the passkey → lose the wrapped secret.** The wrapped secret is
  unrecoverable without the authenticator. Mitigation: "Copy secret key" is always
  available (one unlock) as the backup path, and generate/import warn before
  replacing. No separate "show once" flow is needed.
- **PRF passkeys aren't universal.** The wrapped-keyring path needs a browser +
  authenticator with WebAuthn PRF. Mitigation: **ephemeral paste mode** works with
  no passkey at all — paste an `age1…` to encrypt, or an `AGE-SECRET-KEY-1…` to
  decrypt, storing nothing.
- **One identity, not a keyring.** No multi-key management UI. Encrypting for
  others is handled by pasting a recipient, not by storing contacts. Accepted to
  keep the surface small; a multi-entry keyring can come later if needed.
- **`api.dialog.confirm` doesn't exist yet.** The replace-identity confirmation
  reuses `api.dialog.pick` (Replace / Cancel) rather than introducing a new dialog
  primitive now.
- **Whole-blob, not streaming.** The tool reads the **File** to a `Uint8Array` and
  encrypts/decrypts in one shot. **Blob**s here are small chunks; typage's
  streaming API is left for a future large-file need.

## Notes

This work also introduces the **Segmented control** (`ui.segmented`) collector
primitive — the Encrypt/Decrypt switch — added contract-first in `api.d.ts` and
implemented like every other `ui.*` node (ADR-0003, ADR-0004). It is a routine
primitive, not its own decision, so it has no separate ADR; see its CONTEXT entry.
