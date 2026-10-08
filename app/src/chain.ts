import { createPublicClient, http, encodeFunctionData, parseUnits, parseAbi, type Address, type Hex } from "viem";
import { NET, ATTACKER } from "./config";
import type { Signer } from "./passkey";

export const pub = createPublicClient({ transport: http(NET.rpc) });
const accountAbi = parseAbi([
  "function opDigest(bytes op, uint256 n) view returns (bytes32)",
  "function nonce() view returns (uint256)",
  "function leash(address agent, address token, uint128 dailyCap, uint64 expiry, address[] sellers, string agentURI) returns (uint256)",
  "function revoke(address agent)",
  "function setBrief(address agent, bytes sealedBrief)",
  "function withdraw(address token, address to, uint256 amount)",
]);
const hubAbi = parseAbi(["function check(address agent, address seller, uint256 amount) view returns (uint8, uint256, uint64, uint256, address)"]);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j;
}
export type Setup = { account: Address; agent: Address; twin: Address; token: Address };
export const setupAccount = (s: Signer) => api<Setup>("account", { x: s.x, y: s.y });

async function owner(s: Signer, account: Address, op: Hex) {
  const n = await pub.readContract({ address: account, abi: accountAbi, functionName: "nonce" });
  const digest = await pub.readContract({ address: account, abi: accountAbi, functionName: "opDigest", args: [op, n] });
  const auth = await s.sign(digest);
  return api<{ hash: Hex; status: string; block: string }>("owner", { account, op, auth });
}
export const leashAgent = (s: Signer, st: Setup) => owner(s, st.account, encodeFunctionData({
  abi: accountAbi, functionName: "leash",
  args: [st.agent, st.token, parseUnits("5", 6), BigInt(Math.floor(Date.now() / 1000) + 7 * 86400), [], `${location.origin}/agents/demo.json`],
}));
export const setBrief = (s: Signer, st: Setup, sealed: Hex) => owner(s, st.account, encodeFunctionData({ abi: accountAbi, functionName: "setBrief", args: [st.agent, sealed] }));
export const revokeAgent = (s: Signer, st: Setup) => owner(s, st.account, encodeFunctionData({ abi: accountAbi, functionName: "revoke", args: [st.agent] }));
// ---- "Leash your own agent" (own.html): any agent key, e.g. one made by `npx leash-monad-mcp --new-key`
export const setupOwn = (s: Signer) => api<{ account: Address }>("account", { x: s.x, y: s.y, own: true });
export const leashOwn = (s: Signer, account: Address, a: { agent: Address; token: Address; capUsd: number; days: number; sellers: Address[] }) =>
  owner(s, account, encodeFunctionData({
    abi: accountAbi, functionName: "leash",
    args: [a.agent, a.token, parseUnits(String(a.capUsd), 6), BigInt(Math.floor(Date.now() / 1000) + a.days * 86400), a.sellers, `${location.origin}/agents/own.json`],
  }));
export const fundOwn = (account: Address, agent: Address) => api<{ gasMon: number }>("own", { account, agent });
export const revokeOwn = (s: Signer, account: Address, agent: Address) => owner(s, account, encodeFunctionData({ abi: accountAbi, functionName: "revoke", args: [agent] }));
export const withdrawOwn = (s: Signer, account: Address, token: Address, to: Address, amount: bigint) =>
  owner(s, account, encodeFunctionData({ abi: accountAbi, functionName: "withdraw", args: [token, to, amount] }));
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
export const tokenBalance = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
export const buyForecast = (st: Setup) => api<any>("buy", { account: st.account });
export const runAttack = (st: Setup) => api<{ leashed: Hex[]; unleashed: Hex[] }>("attack", { account: st.account });

export async function sellerCheck(agent: Address, amountUsd = 1, seller: Address = ATTACKER) {
  const r = await pub.readContract({ address: NET.hub, abi: hubAbi, functionName: "check", args: [agent, seller, parseUnits(String(amountUsd), 6)] });
  return { status: r[0], remaining: Number(r[1]) / 1e6, agentId: r[3], account: r[4] };
}

/** The agent's track record, from the Envio indexer (via /api/agent). Null if the indexer is unreachable. */
export async function agentHistory(agent: Address) {
  const r = await fetch(`/api/agent?agent=${agent}`).catch(() => null);
  return r?.ok ? r.json() : null;
}

/** Polls receipts; refusals emit no event, so status 0 on our own hash is the only signal. */
export function watch(hashes: Hex[], on: (i: number, ok: boolean, block: bigint, hash: Hex) => void) {
  const done = new Set<number>();
  return new Promise<void>((resolve) => {
    const tick = async () => {
      await Promise.all(hashes.map(async (h, i) => {
        if (done.has(i)) return;
        const r = await pub.getTransactionReceipt({ hash: h }).catch(() => null);
        if (r) { done.add(i); on(i, r.status === "success", r.blockNumber, h); }
      }));
      if (done.size === hashes.length) resolve(); else setTimeout(tick, 350);
    };
    tick();
  });
}
