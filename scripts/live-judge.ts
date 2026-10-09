// The judge flow against the live site, through the public API only (no server keys): passkey account, leash the demo
// agent at $5/day, buy a forecast, then check the seller's ERC-8004 review of the agent landed on mainnet.
//   npx tsx scripts/live-judge.ts
import { createPublicClient, http, encodeFunctionData, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { softPasskey } from "../lib/webauthn";
import { agentReputation } from "../sdk/src/index";

const SITE = process.env.SITE ?? "https://leash-monad.vercel.app";
const pub = createPublicClient({ transport: http("https://rpc.monad.xyz") });
const abi = parseAbi([
  "function nonce() view returns (uint256)", "function opDigest(bytes op, uint256 n) view returns (bytes32)",
  "function leash(address agent, address token, uint128 dailyCap, uint64 expiry, address[] sellers, string agentURI) returns (uint256)",
  "function leashes(address) view returns (address token, uint128 dailyCap, uint128 spentToday, uint64 day, uint64 expiry, uint64 agentId, bool active, bool anySeller)",
]);
const api = async (path: string, body: unknown) => {
  const r = await fetch(SITE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const j = await r.json(); if (!r.ok) throw new Error(`${path}: ${j.error}`); return j;
};

async function main() {
  const pk = softPasskey({ rpId: "leash-monad.vercel.app" });
  const s = await api("/api/account", { x: pk.x, y: pk.y });
  console.log("account", s.account, "agent", s.agent);
  const op = encodeFunctionData({ abi, functionName: "leash", args: [s.agent, s.token, parseUnits("5", 6), BigInt(Math.floor(Date.now() / 1000) + 86400), [], `${SITE}/agents/demo.json`] });
  const n = await pub.readContract({ address: s.account, abi, functionName: "nonce" });
  const d = await pub.readContract({ address: s.account, abi, functionName: "opDigest", args: [op, n] });
  console.log("leash", (await api("/api/owner", { account: s.account, op, auth: pk.sign(d as Hex) })).hash);
  await new Promise((r) => setTimeout(r, 3000));
  const b = await api("/api/buy", { account: s.account });
  console.log("buy", b.stage, b.status, "payment", b.tx, "review", b.review);
  const id = (await pub.readContract({ address: s.account as Address, abi, functionName: "leashes", args: [s.agent] }))[5];
  const rc = b.review ? await pub.waitForTransactionReceipt({ hash: b.review, timeout: 30_000 }) : null;
  console.log("review receipt", rc?.status, "agent #", id.toString(), await agentReputation(id));
  if (process.argv.includes("--hijack")) {
    // the hijack spends the rest of the day's cap, then the same agent asks the paid API again
    const a = await api("/api/attack", { account: s.account });
    await Promise.all(a.leashed.map((h: Hex) => pub.waitForTransactionReceipt({ hash: h, timeout: 60_000 })));
    const again = await api("/api/buy", { account: s.account }).catch((e) => ({ error: e.message }));
    console.log("after hijack", again.stage, again.status, again.body?.error, "review", again.body?.review);
    if (again.body?.review) await pub.waitForTransactionReceipt({ hash: again.body.review, timeout: 30_000 });
    console.log(await agentReputation(id));
    const fs = await import("node:fs");
    fs.writeFileSync("docs/reviews.json", JSON.stringify({ agentId: id.toString(), agent: s.agent, paid: { payment: b.tx, review: b.review }, refused: { status: again.body?.leash?.status, review: again.body?.review } }, null, 1) + "\n");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
