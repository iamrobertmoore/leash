// "One passkey, many keys": every agent gets its own AES key, derived from the owner's passkey through WebAuthn PRF
// (Mera), namespaced by a per-agent salt. Nothing secret is stored anywhere: the sealed brief lives on the agent's
// public ERC-8004 identity, and any device with the same synced passkey re-derives the key and opens it.
import { getPasskeyPrfOutput } from "@category-labs/mera";
import { parseAbi, type Address, type Hex } from "viem";
import { pub } from "./chain";
import { NET } from "./config";

const enc = new TextEncoder();
const hexOf = (b: Uint8Array) => ("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
const bytesOf = (h: Hex) => new Uint8Array(h.slice(2).match(/../g)!.map((x) => parseInt(x, 16)));

/** The namespace: one salt per agent. Different agent, unrelated key. */
export async function briefSalt(agent: Address) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`leash.brief.v1:${agent.toLowerCase()}`)));
}

async function deriveKey(agent: Address, credentialId?: string) {
  const { prfOutput, credentialId: used } = await getPasskeyPrfOutput({
    rpId: location.hostname, prfSalt: await briefSalt(agent),
    credential: credentialId ? { credentialId } : undefined,
  });
  const fp = hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", prfOutput))).slice(0, 18); // fingerprint only, never the key
  const key = await crypto.subtle.importKey("raw", prfOutput, "AES-GCM", false, ["encrypt", "decrypt"]);
  prfOutput.fill(0);
  return { key, fingerprint: fp, credentialId: used };
}

/** v1 | iv(12) | AES-256-GCM(ciphertext+tag), with the agent address as associated data. */
export async function sealBrief(agent: Address, text: string, credentialId?: string) {
  const { key, fingerprint } = await deriveKey(agent, credentialId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(agent.toLowerCase()) }, key, enc.encode(text)));
  const out = new Uint8Array(1 + 12 + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return { sealed: hexOf(out), fingerprint };
}

export async function unsealBrief(agent: Address, sealed: Hex) {
  const b = bytesOf(sealed);
  if (b[0] !== 1) throw new Error("Unknown brief format");
  const { key, fingerprint } = await deriveKey(agent);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(1, 13), additionalData: enc.encode(agent.toLowerCase()) }, key, b.slice(13));
  return { text: new TextDecoder().decode(pt), fingerprint };
}

const identityAbi = parseAbi(["function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)"]);
const hubAbi = parseAbi(["function check(address agent, address seller, uint256 amount) view returns (uint8, uint256, uint64, uint256, address)"]);

/** Read the sealed brief straight from the agent's ERC-8004 identity. */
export async function readSealedBrief(agent: Address) {
  const r = await pub.readContract({ address: NET.hub, abi: hubAbi, functionName: "check", args: [agent, agent, 0n] });
  const agentId = r[3];
  if (!agentId) throw new Error("This agent isn't on a Leash");
  const sealed = await pub.readContract({ address: NET.identity, abi: identityAbi, functionName: "getMetadata", args: [agentId, "leash.brief"] });
  return { agentId, sealed: sealed as Hex };
}
