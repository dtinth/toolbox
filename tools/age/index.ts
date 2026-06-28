import type { Api } from "../../api.d.ts";
import {
  decryptBytes,
  decryptedName,
  encryptBytes,
  encryptedName,
  generateIdentity,
} from "./age-crypto.ts";
import {
  clearIdentity,
  hasIdentity,
  saveIdentity,
  storedRecipient,
  unlockSecret,
  webauthnSupported,
} from "./age-store.ts";

type Mode = "encrypt" | "decrypt" | "reencrypt";

const shorten = (key: string) => (key.length > 16 ? `${key.slice(0, 12)}…${key.slice(-4)}` : key);
const parseRecipients = (text: string): string[] =>
  text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("age1"));

export default function init(api: Api) {
  let mode: Mode = "encrypt";
  let input: File | null = null;
  let result: File | null = null;
  let recipientText = ""; // ephemeral recipient(s) for encrypt
  let identityText = ""; // ephemeral identity for decrypt
  let armor = false;
  let addSelf = false; // also encrypt to your own key (extra recipient)

  const draw = () => api.requestUpdate();
  const toast = (m: string) => api.toast.show(m, { duration: 3000 });

  const confirmReplace = async (): Promise<boolean> => {
    if (!hasIdentity()) return true;
    const choice = await api.dialog.pick([{ label: "Replace identity" }, { label: "Cancel" }], {
      title: "Replace your identity? The current secret is lost unless you've backed it up.",
    });
    return choice?.label === "Replace identity";
  };

  const persist = async (secret: string, how: string) => {
    try {
      const stored = await api.withProgress({ title: "Saving identity" }, async (p) => {
        p.report({ message: "Wrapping secret to your passkey…" });
        return saveIdentity(secret);
      });
      toast(`${how}: ${shorten(stored.recipient)}`);
      draw();
    } catch (e) {
      toast(`Could not save identity: ${(e as Error).message}`);
    }
  };

  const generate = async () => {
    if (!(await confirmReplace())) return;
    await persist(await generateIdentity(), "New identity");
  };

  const importIdentity = async () => {
    const entered = await api.dialog.input({
      title: "Import identity",
      placeholder: "AGE-SECRET-KEY-1…",
    });
    const secret = entered?.trim();
    if (!secret) return;
    if (!secret.startsWith("AGE-SECRET-KEY-1")) {
      toast("That doesn't look like an AGE-SECRET-KEY-1… identity");
      return;
    }
    if (!(await confirmReplace())) return;
    await persist(secret, "Imported identity");
  };

  const copyPublic = async () => {
    const r = storedRecipient();
    if (!r) return toast("No identity yet — generate or import one");
    await navigator.clipboard.writeText(r);
    toast("Public key copied");
  };

  const copySecret = async () => {
    if (!hasIdentity()) return toast("No identity yet — generate or import one");
    try {
      const secret = await unlockSecret();
      await navigator.clipboard.writeText(secret);
      api.toast.show("Secret key copied — handle with care", { duration: 5000 });
    } catch (e) {
      toast(`Could not unlock: ${(e as Error).message}`);
    }
  };

  const forget = async () => {
    if (!hasIdentity()) return;
    if (!(await confirmReplace())) return;
    clearIdentity();
    toast("Identity forgotten");
    draw();
  };

  const doEncrypt = async () => {
    if (!input) return toast("Choose a file to encrypt");
    const typed = parseRecipients(recipientText);
    const own = storedRecipient();
    const base = typed.length > 0 ? typed : own ? [own] : [];
    // When "also add my own key" is checked, include it as an extra recipient
    // so you can decrypt the file too. Dedupe in case it's already in the list.
    const recipients = addSelf && own ? [...new Set([...base, own])] : base;
    if (recipients.length === 0) {
      return toast("Add a recipient (age1…) or generate an identity first");
    }
    const f = input;
    try {
      await api.withProgress({ title: "Encrypting" }, async (p) => {
        p.report({ message: "Encrypting…" });
        const data = new Uint8Array(await f.arrayBuffer());
        const out = await encryptBytes(recipients, data, { armor });
        result = new File([out as BlobPart], encryptedName(f.name), {
          type: armor ? "text/plain" : "application/age",
        });
        draw();
      });
    } catch (e) {
      toast(`Encryption failed: ${(e as Error).message}`);
    }
  };

  const doDecrypt = async () => {
    if (!input) return toast("Choose an .age file to decrypt");
    // Resolve identities up front, inside the click's user activation — the
    // passkey unlock needs the gesture.
    let identities: string[];
    const typed = identityText.trim();
    if (typed) {
      identities = [typed];
    } else if (hasIdentity()) {
      try {
        identities = [await unlockSecret()];
      } catch (e) {
        return toast(`Could not unlock: ${(e as Error).message}`);
      }
    } else {
      return toast("Paste an AGE-SECRET-KEY-1… or set up an identity first");
    }
    const f = input;
    try {
      await api.withProgress({ title: "Decrypting" }, async (p) => {
        p.report({ message: "Decrypting…" });
        const data = new Uint8Array(await f.arrayBuffer());
        const out = await decryptBytes(identities, data);
        result = new File([out as BlobPart], decryptedName(f.name));
        draw();
      });
    } catch (e) {
      toast(`Decryption failed — wrong key or not an age file (${(e as Error).message})`);
    }
  };

  // Re-encrypt: decrypt a file that's addressed to you, then encrypt the
  // plaintext to new recipient(s). You're always kept as a recipient, so the
  // result stays decryptable by you (the "add my own key" box is forced on).
  const doReencrypt = async () => {
    if (!input) return toast("Choose an .age file to re-encrypt");
    const own = storedRecipient();
    if (!own) return toast("Set up an identity first — re-encryption needs your key");
    const typed = parseRecipients(recipientText);
    const recipients = [...new Set([...typed, own])];
    // Unlock inside the click's user activation — the passkey needs the gesture.
    let identity: string;
    try {
      identity = await unlockSecret();
    } catch (e) {
      return toast(`Could not unlock: ${(e as Error).message}`);
    }
    const f = input;
    try {
      await api.withProgress({ title: "Re-encrypting" }, async (p) => {
        p.report({ message: "Decrypting…" });
        const data = new Uint8Array(await f.arrayBuffer());
        const plain = await decryptBytes([identity], data);
        p.report({ message: "Encrypting…" });
        const out = await encryptBytes(recipients, plain, { armor });
        const name = f.name.endsWith(".age") ? f.name : encryptedName(f.name);
        result = new File([out as BlobPart], name, {
          type: armor ? "text/plain" : "application/age",
        });
        draw();
      });
    } catch (e) {
      toast(`Re-encryption failed — wrong key or not an age file (${(e as Error).message})`);
    }
  };

  api.onRender = () => {
    api.ui.window.setTitle("age");
    api.ui.window.setWidth(420);

    api.ui.menu("Identity", () => {
      api.ui.menuItem("Generate random identity…", { onClick: () => void generate() });
      api.ui.menuItem("Import identity…", { onClick: () => void importIdentity() });
      api.ui.menuSeparator();
      api.ui.menuItem("Copy public key", { onClick: () => void copyPublic() });
      api.ui.menuItem("Copy secret key", { onClick: () => void copySecret() });
      api.ui.menuSeparator();
      api.ui.menuItem("Forget identity", { onClick: () => void forget() });
    });

    api.ui.segmented(mode, {
      options: [
        { value: "encrypt", label: "Encrypt" },
        { value: "decrypt", label: "Decrypt" },
        { value: "reencrypt", label: "Re-encrypt" },
      ],
      onChange: (v) => {
        mode = v as Mode;
        result = null;
        draw();
      },
    });

    const own = storedRecipient();
    if (own) {
      api.ui.label("Your public key:");
      api.ui.copyableText(own);
    } else {
      api.ui.label(
        webauthnSupported()
          ? "No identity yet — use the Identity menu, or paste keys below."
          : "No passkey support here — use ephemeral keys below.",
      );
    }

    const fileLabel =
      mode === "encrypt"
        ? "Choose, drop, or paste a file to encrypt"
        : mode === "decrypt"
          ? "Choose, drop, or paste an .age file to decrypt"
          : "Choose, drop, or paste an .age file to re-encrypt";
    api.ui.file(input, {
      label: fileLabel,
      onFile: (f) => {
        input = f;
        result = null;
        draw();
      },
    });

    if (mode === "encrypt") {
      api.ui.textInput(recipientText, {
        placeholder: own ? "Recipient age1… (blank = your own key)" : "Recipient age1…",
        onChange: (v) => {
          recipientText = v;
        },
      });
      api.ui.checkbox("Also add my own key as a recipient", {
        checked: addSelf,
        disabled: !own,
        onChange: (v) => {
          addSelf = v;
          draw();
        },
      });
      api.ui.checkbox("ASCII armor (text output)", {
        checked: armor,
        onChange: (v) => {
          armor = v;
          draw();
        },
      });
      api.ui.button("Encrypt", { onClick: () => void doEncrypt() });
    } else if (mode === "decrypt") {
      if (!hasIdentity()) {
        api.ui.textInput(identityText, {
          placeholder: "Identity AGE-SECRET-KEY-1…",
          onChange: (v) => {
            identityText = v;
          },
        });
      }
      api.ui.button(hasIdentity() ? "Decrypt (unlock with passkey)" : "Decrypt", {
        onClick: () => void doDecrypt(),
      });
    } else {
      api.ui.textInput(recipientText, {
        placeholder: "Add recipient age1…",
        onChange: (v) => {
          recipientText = v;
        },
      });
      // Re-encryption always keeps you as a recipient — forced on, can't toggle.
      api.ui.checkbox("Also add my own key as a recipient", { checked: true, disabled: true });
      api.ui.checkbox("ASCII armor (text output)", {
        checked: armor,
        onChange: (v) => {
          armor = v;
          draw();
        },
      });
      api.ui.button(hasIdentity() ? "Re-encrypt (unlock with passkey)" : "Re-encrypt", {
        onClick: () => void doReencrypt(),
      });
    }

    const outputLabel =
      mode === "encrypt"
        ? "Encrypted output:"
        : mode === "decrypt"
          ? "Decrypted output:"
          : "Re-encrypted output:";
    const outputPlaceholder =
      mode === "encrypt"
        ? "Encrypted file appears here"
        : mode === "decrypt"
          ? "Decrypted file appears here"
          : "Re-encrypted file appears here";
    api.ui.label(outputLabel);
    api.ui.file(result, {
      readOnly: true,
      label: outputPlaceholder,
    });
  };
}
