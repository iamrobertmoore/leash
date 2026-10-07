// leash-monad-mcp: an MCP server that lets any AI agent pay inside its Leash on Monad.
//
// The agent's key lives here (LEASH_AGENT_KEY). It can only move money through LeashAccount.pay(), which checks the
// leash its owner's passkey set (daily cap, allowed sellers, expiry) inside the same transaction. So whatever the model
// is told, by a user or by a prompt injection, the worst case is the owner's daily cap.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkAgent, payWithLeash, proofMessage, networks, type LeashNetwork, type Verdict } from "leash-monad";
import { keccak256, toHex, isAddress, parseAbi, toFunctionSelector, BaseError, ContractFunctionRevertedError, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const env = process.env;

if (process.argv.includes("--new-key")) {
  // One-time setup: make a fresh agent key. The owner leashes its address with their passkey; the key goes in LEASH_AGENT_KEY.
  const key = generatePrivateKey();
  console.log(`Agent address: ${privateKeyToAccount(key).address}\nAgent key:     ${key}\n\n1. Open https://leash-monad.vercel.app/#own, sign in with your passkey and leash this address (daily cap, sellers, expiry).\n2. Put the key in your MCP client config as LEASH_AGENT_KEY. Keep it private; at worst it can spend the daily cap you set.`);
  process.exit(0);
}
const base: LeashNetwork = networks[(env.LEASH_NETWORK as keyof typeof networks) ?? "mainnet"] ?? networks.mainnet;
const network: LeashNetwork = {
  ...base,
  ...(env.LEASH_RPC ? { rpc: env.LEASH_RPC } : {}),
  ...(env.LEASH_HUB ? { hub: env.LEASH_HUB as Address } : {}),
  ...(env.LEASH_CHAIN_ID ? { chainId: Number(env.LEASH_CHAIN_ID) } : {}),
  ...(env.LEASH_EXPLORER ? { explorer: env.LEASH_EXPLORER } : {}),
};
const leashErrors = parseAbi([
  "error UnknownAgent()", "error AgentRevoked()", "error LeashExpired(uint64 expiry)",
  "error SellerNotAllowed(address seller)", "error OverCap(uint256 remainingToday, uint256 attempted)",
]);
/** Why the chain said no, in words, with the transaction when there is one. */
const errorBySelector = Object.fromEntries(leashErrors.map((e) => [toFunctionSelector(`${e.name}(${e.inputs.map((i) => i.type).join(",")})`), e.name]));
function refusal(err: any): string {
  if (err?.hash) return `Refused on-chain by the leash: ${txUrl(err.hash)}`;
  const revert = err instanceof BaseError ? (err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null) : null;
  if (revert) {
    const name = revert.data?.errorName ?? (revert.signature ? errorBySelector[revert.signature] : undefined) ?? "reverted";
    return `Refused on-chain by the leash contract: ${name}`;
  }
  return `Not paid: ${err?.shortMessage ?? err?.message ?? err}`;
}
const agent = env.LEASH_AGENT_KEY ? privateKeyToAccount(env.LEASH_AGENT_KEY as Hex) : null;
const o = { network };

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ ...text(msg), isError: true });
const txUrl = (h: string) => `${network.explorer}/tx/${h}`;
const addr = z.string().refine(isAddress, "must be a 0x address");
const usd = z.string().regex(/^\d+(\.\d{1,6})?$/, "dollars, e.g. \"1\" or \"0.25\"");
const needAgent = () => (agent ? null : fail("No agent key configured. Set LEASH_AGENT_KEY to the agent key its owner leashed at https://leash-monad.vercel.app."));
const short = (v: Verdict) => ({ status: v.status, ok: v.ok, reason: v.reason, remainingTodayUsd: v.remainingToday, expiresAt: v.expiry ? new Date(v.expiry * 1000).toISOString() : null, erc8004Id: v.erc8004Id, account: v.account });

const server = new McpServer({ name: "leash-monad", version: "0.1.0" });

server.registerTool("check_agent", {
  title: "Check an agent's leash",
  description: "Before serving or accepting money from an AI agent: would a payment of this size from this agent to this seller go through right now? Returns OK, OVER_CAP, REVOKED, EXPIRED, SELLER_NOT_ALLOWED or UNKNOWN_AGENT, plus what it has left today. One free on-chain read on Monad.",
  inputSchema: { agent: addr.describe("The agent's address"), seller: addr.describe("Who would be paid"), amount_usd: usd.describe("Payment size in dollars") },
}, async ({ agent: a, seller, amount_usd }) => text(short(await checkAgent(a as Address, seller as Address, amount_usd, o))));

server.registerTool("my_budget", {
  title: "My budget today",
  description: "This agent's own leash: who owns it, whether it may pay a given seller, and how many dollars it can still spend today.",
  inputSchema: { seller: addr.optional().describe("Optional: check against this seller") },
}, async ({ seller }) => {
  const e = needAgent(); if (e) return e;
  const v = await checkAgent(agent!.address, (seller ?? agent!.address) as Address, "0", o);
  return text({ agent: agent!.address, ...short(v), ...(seller ? {} : { note: "No seller given, so status reflects paying yourself; remainingTodayUsd is your budget." }) });
});

server.registerTool("pay", {
  title: "Pay a seller inside the leash",
  description: "Pay a seller from the agent's Leash account on Monad. Checks the leash first and refuses without sending anything if the payment would break it (over the daily cap, seller not allowed, revoked or expired). Set enforce_on_chain to send it anyway and let the contract refuse it, which costs a little gas and leaves a public record.",
  inputSchema: {
    seller: addr, amount_usd: usd, memo: z.string().max(200).describe("What this payment is for (hashed into the on-chain reference)"),
    enforce_on_chain: z.boolean().optional(),
  },
}, async ({ seller, amount_usd, memo, enforce_on_chain }) => {
  const e = needAgent(); if (e) return e;
  const v = await checkAgent(agent!.address, seller as Address, amount_usd, o);
  if (!v.ok && !enforce_on_chain) return fail(`Not paid: ${v.reason} (${v.status}, $${v.remainingToday} left today)`);
  const ref = keccak256(toHex(`${memo}:${Date.now()}`));
  try {
    const hash = await payWithLeash(agent!, seller as Address, amount_usd, ref, o);
    const after = await checkAgent(agent!.address, seller as Address, "0", o);
    return text({ paid: true, amountUsd: amount_usd, seller, tx: hash, explorer: txUrl(hash), remainingTodayUsd: after.remainingToday });
  } catch (err: any) {
    return fail(refusal(err));
  }
});

server.registerTool("fetch_paid", {
  title: "Fetch a paid URL",
  description: "Fetch a URL that may charge per call (HTTP 402, Leash gate). If it asks for payment and the price fits the leash, pays once from the agent's Leash account and retries. Returns the response body. Never pays more than the price the server asked for, and never past the leash.",
  inputSchema: {
    url: z.string().url(), method: z.enum(["GET", "POST"]).optional(), body: z.string().optional(),
    max_price_usd: usd.optional().describe("Optional ceiling for this one call"),
  },
}, async ({ url, method, body, max_price_usd }) => {
  const e = needAgent(); if (e) return e;
  const resource = new URL(url).pathname, nonce = toHex(crypto.getRandomValues(new Uint8Array(12)));
  const proof = await agent!.signMessage({ message: proofMessage(resource, nonce) });
  const headers: Record<string, string> = { "x-leash-agent": agent!.address, "x-leash-nonce": nonce, "x-leash-proof": proof, ...(body ? { "content-type": "application/json" } : {}) };
  const init = { method: method ?? "GET", headers, body };
  const first = await fetch(url, init);
  if (first.status === 403) {
    const no = await first.json().catch(() => ({}));
    return fail(`Not paid: the seller refused this agent. ${no?.leash?.reason ?? no?.reason ?? ""} (${no?.leash?.status ?? no?.error ?? 403})`.trim());
  }
  if (first.status !== 402) return text({ status: first.status, paid: false, body: (await first.text()).slice(0, 4000) });
  const ask = await first.json().catch(() => ({}));
  if (!ask.ref || !ask.payTo || !ask.price) return fail(`The server asked for payment but didn't say how: ${JSON.stringify(ask).slice(0, 500)}`);
  if (max_price_usd && Number(ask.price) > Number(max_price_usd)) return fail(`Not paid: the server asks $${ask.price}, above your ceiling of $${max_price_usd}.`);
  const v = await checkAgent(agent!.address, ask.payTo, ask.price, o);
  if (!v.ok) return fail(`Not paid: ${v.reason} (${v.status}, $${v.remainingToday} left today, price $${ask.price})`);
  let hash: Hex;
  try { hash = await payWithLeash(agent!, ask.payTo, ask.price, ask.ref, o); }
  catch (err: any) { return fail(refusal(err)); }
  const second = await fetch(url, { ...init, headers: { ...headers, "x-leash-payment": hash } });
  return text({ status: second.status, paid: true, priceUsd: ask.price, tx: hash, explorer: txUrl(hash), body: (await second.text()).slice(0, 4000) });
});

await server.connect(new StdioServerTransport());
