// Records the mainnet proof table: one allowed payment and one refusal per rule, each a real Monad transaction.
// Runs exactly like a judge in a browser: public API only (no server keys), a software passkey that produces
// browser-identical WebAuthn bytes, and agent keys that live in memory for this run only.
//   npx tsx scripts/proofs.ts            -> writes docs/proofs.json
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, parseUnits, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { softPasskey } from "../lib/webauthn";
import { monadMainnet } from "../server/config";

const SITE = "https://leash-monad.vercel.app";
const SELLER = "0xFB331d9DB7f6F25DCBcCF9a2Bd86986198F07bA5" as Address; // the live paid API's payTo
const STRANGER = "0x000000000000000000000000000000000badF00D" as Address;
const TUSD = "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3" as Address;
const abi = parseAbi([
  "function nonce() view returns (uint256)",
  "function opDigest(bytes op, uint256 n) view returns (bytes32)",
  "function leash(address agent, address token, uint128 dailyCap, uint64 expiry, address[] sellers, string agentURI) returns (uint256)",
  "function revoke(address agent)",
  "function pay(address seller, uint256 amount, bytes32 ref)",
]);
const pub = createPublicClient({ chain: monadMainnet, transport: http() });
const usd = (n: number) => parseUnits(String(n), 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, body: unknown) {
  const r = await fetch(SITE + path, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}

async function owner(pk: ReturnType<typeof softPasskey>, account: Address, op: Hex) {
  const n = await pub.readContract({ address: account, abi, functionName: "nonce" });
  const digest = await pub.readContract({ address: account, abi, functionName: "opDigest", args: [op, n] });
  return api("/api/owner", { account, op, auth: pk.sign(digest) });
}

/** Sends pay() with a fixed gas limit so a refusal is mined as a reverted transaction rather than caught locally. */
async function pay(key: Hex, account: Address, seller: Address, amount: number, note: string) {
  const w = createWalletClient({ chain: monadMainnet, transport: http(), account: privateKeyToAccount(key) });
  const hash = await w.writeContract({ address: account, abi, functionName: "pay", args: [seller, usd(amount), toHex(note, { size: 32 })], gas: 120_000n });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return { hash, status: rc.status, block: rc.blockNumber.toString() };
}

async function gas(account: Address, agent: Address) {
  await api("/api/own", { account, agent });
  for (let i = 0; i < 20 && (await pub.getBalance({ address: agent })) < 50_000_000_000_000_000n; i++) await sleep(1500);
  await sleep(5000); // Monad checks gas balance against state a few blocks behind the tip
}

async function main() {
  const pk = softPasskey({ rpId: "leash-monad.vercel.app" });
  const { account } = await api("/api/account", { x: pk.x, y: pk.y, own: true });
  console.log("account", account);
  const week = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
  const uri = `${SITE}/agents/own.json`;
  const rows: { case: string; expect: string; amountUsd: number; seller: Address; agent: Address; hash: Hex; status: string; block: string }[] = [];

  // Agent A: $3 a day, may pay only the paid API.
  const a = generatePrivateKey(), A = privateKeyToAccount(a).address;
  console.log("leash A", (await owner(pk, account, encodeFunctionData({ abi, functionName: "leash", args: [A, TUSD, usd(3), week, [SELLER], uri] }))).hash);
  await gas(account, A);
  const add = async (c: string, expect: string, key: Hex, agent: Address, seller: Address, amt: number) => {
    const r = await pay(key, account, seller, amt, `leash-proof:${c}`);
    rows.push({ case: c, expect, amountUsd: amt, seller, agent, ...r });
    console.log(c.padEnd(14), r.status, r.hash);
  };
  await add("allowed", "paid", a, A, SELLER, 1);
  await add("over-cap", "OverCap", a, A, SELLER, 5);
  await add("wrong-seller", "SellerNotAllowed", a, A, STRANGER, 1);
  console.log("revoke A", (await owner(pk, account, encodeFunctionData({ abi, functionName: "revoke", args: [A] }))).hash);
  await add("revoked", "AgentRevoked", a, A, SELLER, 1);

  // Agent B: a leash that runs out a minute from now.
  const b = generatePrivateKey(), B = privateKeyToAccount(b).address;
  const soon = BigInt((await pub.getBlock()).timestamp + 60n);
  console.log("leash B", (await owner(pk, account, encodeFunctionData({ abi, functionName: "leash", args: [B, TUSD, usd(3), soon, [], uri] }))).hash);
  await gas(account, B);
  while ((await pub.getBlock()).timestamp <= soon + 5n) await sleep(3000);
  await add("expired", "LeashExpired", b, B, SELLER, 1);

  fs.writeFileSync("docs/proofs.json", JSON.stringify({ chainId: 143, account, recorded: new Date().toISOString(), rows }, null, 1) + "\n");
  console.log("wrote docs/proofs.json");
}
main().catch((e) => { console.error(e); process.exit(1); });
