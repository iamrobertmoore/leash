// Software passkey for tests, scripts and the judges' fallback. It produces exactly what a browser's
// navigator.credentials.get() returns (authenticatorData + clientDataJSON + P-256 signature), so the
// contract path is identical to a real Face ID / Touch ID passkey.
import crypto from "node:crypto";
import { type Hex, toHex } from "viem";

const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

export type SoftPasskey = { x: Hex; y: Hex; sign: (challenge: Hex) => WebAuthnAuth };
export type WebAuthnAuth = {
  authenticatorData: Hex;
  clientDataJSON: string;
  challengeIndex: bigint;
  typeIndex: bigint;
  r: Hex;
  s: Hex;
};

const b64url = (b: Buffer) => b.toString("base64url");

export function softPasskey(opts: { rpId?: string; origin?: string; privateKeyPem?: string } = {}): SoftPasskey {
  const rpId = opts.rpId ?? "leash.local";
  const origin = opts.origin ?? `https://${rpId}`;
  const key = opts.privateKeyPem
    ? crypto.createPrivateKey(opts.privateKeyPem)
    : crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  const jwk = crypto.createPublicKey(key).export({ format: "jwk" }) as { x: string; y: string };
  const x = ("0x" + Buffer.from(jwk.x, "base64url").toString("hex").padStart(64, "0")) as Hex;
  const y = ("0x" + Buffer.from(jwk.y, "base64url").toString("hex").padStart(64, "0")) as Hex;
  let counter = 0;

  return {
    x,
    y,
    sign(challenge: Hex): WebAuthnAuth {
      const rpIdHash = crypto.createHash("sha256").update(rpId).digest();
      const flags = Buffer.from([0x05]); // UP | UV
      const count = Buffer.alloc(4);
      count.writeUInt32BE(++counter);
      const authenticatorData = Buffer.concat([rpIdHash, flags, count]);
      const clientDataJSON = JSON.stringify({
        type: "webauthn.get",
        challenge: b64url(Buffer.from(challenge.slice(2), "hex")),
        origin,
        crossOrigin: false,
      });
      const signed = Buffer.concat([
        authenticatorData,
        crypto.createHash("sha256").update(clientDataJSON).digest(),
      ]);
      const sig = crypto.sign("sha256", signed, { key, dsaEncoding: "ieee-p1363" });
      const r = BigInt("0x" + sig.subarray(0, 32).toString("hex"));
      let s = BigInt("0x" + sig.subarray(32).toString("hex"));
      if (s > N / 2n) s = N - s; // low-s, as P256.verifySignature expects
      return {
        authenticatorData: toHex(authenticatorData),
        clientDataJSON,
        challengeIndex: BigInt(clientDataJSON.indexOf('"challenge"')),
        typeIndex: BigInt(clientDataJSON.indexOf('"type"')),
        r: toHex(r, { size: 32 }),
        s: toHex(s, { size: 32 }),
      };
    },
  };
}
