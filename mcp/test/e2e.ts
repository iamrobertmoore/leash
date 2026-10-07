// End-to-end test of leash-monad-mcp against a local chain (hardhat node with the P256 precompile on):
// deploy, leash an agent at $4/day, run a real Leash-gated paid API, then drive the MCP server over stdio
// exactly as an AI client would. Run: npx hardhat node & npx tsx mcp/test/e2e.ts
import http from "node:http";
import assert from "node:assert/strict";
import { createPublicClient, createWalletClient, http as rpc, encodeFunctionData, parseUnits, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { leashGate, payWithLeash, proofMessage } from "../../sdk/src/index";
import { toHex } from "viem";
import { softPasskey } from "../../lib/webauthn";
import fs from "node:fs";

const RPC = "http://127.0.0.1:8545";
// hardhat's public test keys
const DEPLOYER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const AGENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const SELLER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const art = (n: string) => JSON.parse(fs.readFileSync(`artifacts/contracts/${n}.sol/${n}.json`, "utf8"));
const usd = (n: number) => parseUnits(String(n), 6);

const pub = createPublicClient({ chain: hardhat, transport: rpc(RPC) });
const w = createWalletClient({ account: DEPLOYER, chain: hardhat, transport: rpc(RPC) });
async function deploy(n: string, args: unknown[] = []) {
  const a = art(n); const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  return { address: (await pub.waitForTransactionReceipt({ hash })).contractAddress!, abi: a.abi };
}
const send = async (address: Address, abi: any, functionName: string, args: unknown[]) =>
  pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args } as any) });

const identity = await deploy("MockIdentityRegistry");
const hub = await deploy("LeashHub", [identity.address]);
const tusd = await deploy("TestUSD");
const pk = softPasskey();
await send(hub.address, hub.abi, "createAccount", [pk.x, pk.y]);
const account = (await pub.readContract({ address: hub.address, abi: hub.abi, functionName: "predict", args: [pk.x, pk.y] })) as Address;
const acctAbi = art("LeashAccount").abi;
await send(tusd.address, tusd.abi, "mint", [account, usd(50)]);
const agent = privateKeyToAccount(AGENT_KEY);
const now = Number((await pub.getBlock()).timestamp);
const op = encodeFunctionData({ abi: acctAbi, functionName: "leash", args: [agent.address, tusd.address, usd(4), BigInt(now + 86400), [SELLER], ""] });
const nonce = await pub.readContract({ address: account, abi: acctAbi, functionName: "nonce" });
const digest = await pub.readContract({ address: account, abi: acctAbi, functionName: "opDigest", args: [op, nonce] }) as Hex;
await send(account, acctAbi, "ownerExecute", [op, pk.sign(digest)]);
console.log("leashed", agent.address, "at $4/day on account", account);

// a real paid API behind the SDK's gate
const network = { name: "local", chainId: 31337, rpc: RPC, explorer: "http://local", hub: hub.address, identityRegistry: identity.address };
const used = new Set<string>();
const claim = (tx: string) => (used.has(tx) ? false : (used.add(tx), true));
const api = http.createServer(async (req, res) => {
  const g = await leashGate({ method: req.method!, url: req.url!, headers: req.headers }, { seller: SELLER, priceUsd: "1", network, claim, acceptTokens: [tusd.address] });
  res.setHeader("content-type", "application/json");
  if (!g.allow) { res.statusCode = g.status; return res.end(JSON.stringify(g.body)); }
  res.end(JSON.stringify({ forecast: "sunny", paid: g.paid }));
});
await new Promise<void>((r) => api.listen(8799, r));

// the MCP server, as a client would run it
const client = new Client({ name: "e2e", version: "0" });
await client.connect(new StdioClientTransport({
  command: "node", args: ["mcp/dist/index.js"],
  env: { ...process.env, LEASH_AGENT_KEY: AGENT_KEY, LEASH_RPC: RPC, LEASH_HUB: hub.address, LEASH_CHAIN_ID: "31337" } as Record<string, string>,
}));
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  const t = r.content[0].text; console.log(`\n> ${name} ${JSON.stringify(args)}\n${t}`);
  return { error: !!r.isError, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ["check_agent", "fetch_paid", "my_budget", "pay"]);

let r = await call("my_budget", { seller: SELLER });
assert.equal(r.json.status, "OK"); assert.equal(r.json.remainingTodayUsd, "4");

r = await call("fetch_paid", { url: "http://127.0.0.1:8799/forecast" });
assert.equal(r.json.status, 200); assert.equal(r.json.paid, true); assert.match(r.json.body, /sunny/);

// one payment buys one response: replaying the same payment proof is refused
{
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(12)));
  const h = { "x-leash-agent": agent.address, "x-leash-nonce": nonce, "x-leash-proof": await agent.signMessage({ message: proofMessage("/forecast", nonce) }) };
  const ask = await (await fetch("http://127.0.0.1:8799/forecast", { headers: h })).json();
  const tx = await payWithLeash(agent, ask.payTo, ask.price, ask.ref, { network });
  const first = await fetch("http://127.0.0.1:8799/forecast", { headers: { ...h, "x-leash-payment": tx } });
  const again = await fetch("http://127.0.0.1:8799/forecast", { headers: { ...h, "x-leash-payment": tx } });
  assert.equal(first.status, 200); assert.equal(again.status, 402); assert.equal((await again.json()).error, "payment_used");
  console.log("\nreplayed payment proof refused: payment_used");
}

// a leash that pays in some other token can't buy anything: the gate checks the token
{
  const junk = await deploy("TestUSD");
  await send(junk.address, junk.abi, "mint", [account, usd(50)]);
  const rogue = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
  const op2 = encodeFunctionData({ abi: acctAbi, functionName: "leash", args: [rogue.address, junk.address, usd(5), BigInt(now + 86400), [SELLER], ""] });
  const n2 = await pub.readContract({ address: account, abi: acctAbi, functionName: "nonce" });
  const d2 = await pub.readContract({ address: account, abi: acctAbi, functionName: "opDigest", args: [op2, n2] }) as Hex;
  await send(account, acctAbi, "ownerExecute", [op2, pk.sign(d2)]);
  await w.sendTransaction({ to: rogue.address, value: 10n ** 17n }).then((h) => pub.waitForTransactionReceipt({ hash: h }));
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(12)));
  const h = { "x-leash-agent": rogue.address, "x-leash-nonce": nonce, "x-leash-proof": await rogue.signMessage({ message: proofMessage("/forecast", nonce) }) };
  const ask = await (await fetch("http://127.0.0.1:8799/forecast", { headers: h })).json();
  const tx = await payWithLeash(rogue, ask.payTo, ask.price, ask.ref, { network });
  const res = await fetch("http://127.0.0.1:8799/forecast", { headers: { ...h, "x-leash-payment": tx } });
  assert.equal(res.status, 402); assert.equal((await res.json()).error, "token_not_accepted");
  console.log("payment in an unaccepted token refused: token_not_accepted");
}

r = await call("pay", { seller: SELLER, amount_usd: "1", memo: "tip" });
assert.equal(r.json.paid, true); assert.equal(r.json.remainingTodayUsd, "1");

r = await call("pay", { seller: SELLER, amount_usd: "5", memo: "too much" });
assert.ok(r.error); assert.match(r.text, /OVER_CAP/);

r = await call("pay", { seller: SELLER, amount_usd: "5", memo: "too much", enforce_on_chain: true });
assert.ok(r.error); assert.match(r.text, /Refused on-chain/);

r = await call("pay", { seller: DEPLOYER.address, amount_usd: "0.5", memo: "not allowed" });
assert.ok(r.error); assert.match(r.text, /SELLER_NOT_ALLOWED/);

r = await call("fetch_paid", { url: "http://127.0.0.1:8799/forecast", max_price_usd: "0.5" });
assert.ok(r.error); assert.match(r.text, /ceiling/);

r = await call("fetch_paid", { url: "http://127.0.0.1:8799/forecast" });
assert.equal(r.json.status, 200);

r = await call("fetch_paid", { url: "http://127.0.0.1:8799/forecast" });
assert.ok(r.error); assert.match(r.text, /OVER_CAP/);

r = await call("check_agent", { agent: agent.address, seller: SELLER, amount_usd: "1" });
assert.equal(r.json.status, "OVER_CAP"); assert.equal(r.json.remainingTodayUsd, "0");

const paid = await pub.readContract({ address: tusd.address, abi: tusd.abi, functionName: "balanceOf", args: [SELLER] }) as bigint;
assert.equal(paid, usd(4));
console.log("\nALL MCP CHECKS PASSED: $4 paid in total (the cap); every overspend, the replayed payment and the wrong token refused.");
await client.close(); api.close(); process.exit(0);
