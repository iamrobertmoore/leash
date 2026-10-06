// Browser passkeys. A real platform passkey (Face ID / Touch ID / Windows Hello) when available, or a demo key
// held in this tab that produces the exact same WebAuthn bytes, for judges without a passkey device.
// Either way the contract verifies the P-256 signature on-chain through Monad's precompile at 0x100.
import type { Hex } from "viem";

export type Auth = { authenticatorData: Hex; clientDataJSON: string; challengeIndex: string; typeIndex: string; r: Hex; s: Hex };
export type Signer = { kind: "passkey" | "demo"; x: Hex; y: Hex; sign: (digest: Hex) => Promise<Auth> };

const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const hex = (b: ArrayBuffer | Uint8Array) =>
  ("0x" + [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
const bytes = (h: Hex) => new Uint8Array(h.slice(2).match(/../g)!.map((x) => parseInt(x, 16)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const pad32 = (b: Uint8Array) => { const o = new Uint8Array(32); o.set(b.slice(-32), 32 - Math.min(32, b.length)); return o; };

function lowS(r: Uint8Array, s: Uint8Array) {
  let sv = BigInt(hex(s));
  if (sv > N / 2n) sv = N - sv;
  return { r: hex(pad32(r)), s: ("0x" + sv.toString(16).padStart(64, "0")) as Hex };
}
function derToRS(der: Uint8Array) {
  // SEQUENCE { INTEGER r, INTEGER s }
  let i = 2; if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const rl = der[i + 1]; const r = der.slice(i + 2, i + 2 + rl); i = i + 2 + rl;
  const sl = der[i + 1]; const s = der.slice(i + 2, i + 2 + sl);
  return lowS(r, s);
}
function indices(json: string) {
  return { challengeIndex: String(json.indexOf('"challenge"')), typeIndex: String(json.indexOf('"type"')) };
}
async function xyFromSpki(spki: ArrayBuffer) {
  const k = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", k);
  return { x: hex(pad32(fromB64url(jwk.x!))), y: hex(pad32(fromB64url(jwk.y!))) };
}

const STORE = "leash.passkey.v1";
export function savedCredentialId() { return savedPasskey()?.id; }
export function savedPasskey(): { id: string; x: Hex; y: Hex } | null {
  try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; }
}

export async function passkeySupported() {
  return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()));
}

function realSigner(id: string, x: Hex, y: Hex): Signer {
  return {
    kind: "passkey", x, y,
    async sign(digest) {
      const cred = (await navigator.credentials.get({
        publicKey: {
          challenge: bytes(digest), userVerification: "required", timeout: 60_000,
          allowCredentials: [{ type: "public-key", id: fromB64url(id) }],
        },
      })) as PublicKeyCredential;
      const res = cred.response as AuthenticatorAssertionResponse;
      const clientDataJSON = new TextDecoder().decode(res.clientDataJSON);
      return { authenticatorData: hex(res.authenticatorData), clientDataJSON, ...indices(clientDataJSON), ...derToRS(new Uint8Array(res.signature)) };
    },
  };
}

export async function createPasskey(): Promise<Signer> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Leash" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "leash-owner", displayName: "Leash owner" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs, // lets the same passkey derive per-agent keys (Mera)
      timeout: 60_000,
    },
  })) as PublicKeyCredential;
  const spki = (cred.response as AuthenticatorAttestationResponse).getPublicKey();
  if (!spki) throw new Error("This browser did not return the passkey's public key");
  const { x, y } = await xyFromSpki(spki);
  const id = b64url(new Uint8Array(cred.rawId));
  try { localStorage.setItem(STORE, JSON.stringify({ id, x, y })); } catch {}
  return realSigner(id, x, y);
}

export function resumePasskey(): Signer | null {
  const s = savedPasskey(); return s ? realSigner(s.id, s.x, s.y) : null;
}

/** Demo key: a P-256 key in this tab that signs exactly like a WebAuthn authenticator (UP+UV flags set). */
export async function demoSigner(): Promise<Signer> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const { x, y } = await xyFromSpki(await crypto.subtle.exportKey("spki", kp.publicKey));
  let count = 0;
  return {
    kind: "demo", x, y,
    async sign(digest) {
      const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(location.hostname)));
      const authData = new Uint8Array(37); authData.set(rpIdHash); authData[32] = 0x05; new DataView(authData.buffer).setUint32(33, ++count);
      const clientDataJSON = JSON.stringify({ type: "webauthn.get", challenge: b64url(bytes(digest)), origin: location.origin, crossOrigin: false });
      const cdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientDataJSON)));
      const msg = new Uint8Array(authData.length + 32); msg.set(authData); msg.set(cdHash, authData.length);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, msg));
      return { authenticatorData: hex(authData), clientDataJSON, ...indices(clientDataJSON), ...lowS(sig.slice(0, 32), sig.slice(32)) };
    },
  };
}
