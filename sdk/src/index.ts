/**
 * leash-monad: spend limits for AI agents, enforced on Monad.
 *
 * Seller side:  checkAgent() before you serve, leashGate() as drop-in HTTP middleware (402 until paid).
 * Agent side:   payWithLeash() to pay inside the leash, fetchWithLeash() to handle a 402 automatically.
 */
import {
  createPublicClient, createWalletClient, http, parseUnits, formatUnits, keccak256, toHex, decodeEventLog,
  verifyMessage, zeroHash, type Address, type Hex, type PublicClient, type Account, type Chain,
} from "viem";
import { networks, type LeashNetwork } from "./networks";
import { hubAbi, accountAbi, reputationAbi } from "./abi";
import { checkSeller, type SellerPolicy } from "./policy";

export { networks, hubAbi, accountAbi, reputationAbi };
export { checkSeller, SCLERA, scleraAbi } from "./policy";
export type { SellerPolicy, SellerVerdict, SellerBond } from "./policy";
export type { LeashNetwork };

export const STATUS = ["OK", "UNKNOWN_AGENT", "REVOKED", "EXPIRED", "SELLER_NOT_ALLOWED", "OVER_CAP"] as const;
export type LeashStatus = (typeof STATUS)[number];

export type Options = { network?: LeashNetwork | keyof typeof networks; client?: PublicClient; decimals?: number };
const net = (o: Options = {}): LeashNetwork => (typeof o.network === "string" ? networks[o.network] : o.network) ?? networks.mainnet;
const clientFor = (o: Options = {}) => o.client ?? (createPublicClient({ transport: http(net(o).rpc) }) as PublicClient);
const chainOf = (n: LeashNetwork): Chain => ({ id: n.chainId, name: n.name, nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [n.rpc] } } });

export type Verdict = {
  /** OK means this payment would go through right now. */
  status: LeashStatus;
  ok: boolean;
  /** What the agent can still spend today, in dollars (string, 2+ decimals). */
  remainingToday: string;
  /** Unix seconds when the leash expires (0 if unknown agent). */
  expiry: number;
  /** The agent's ERC-8004 identity id in Monad's registry. */
  erc8004Id: string;
  /** The passkey-owned Leash account the agent belongs to. */
  account: Address | null;
  /** A one-line, human-readable reason, safe to return to the agent. */
  reason: string;
};

const REASONS: Record<LeashStatus, string> = {
  OK: "This agent is leashed and this payment fits its budget.",
  UNKNOWN_AGENT: "This agent has no leash. Its owner hasn't set a spend limit.",
  REVOKED: "The owner revoked this agent.",
  EXPIRED: "This agent's leash has expired.",
  SELLER_NOT_ALLOWED: "The owner hasn't allowed this agent to pay you.",
  OVER_CAP: "This payment would take the agent over its daily limit.",
};

/** The seller's question, answered by Monad in one read: if this agent pays me this much, will it go through? */
export async function checkAgent(agent: Address, seller: Address, amountUsd: string | number, o: Options = {}): Promise<Verdict> {
  const d = o.decimals ?? 6;
  const r = await clientFor(o).readContract({
    address: net(o).hub, abi: hubAbi, functionName: "check", args: [agent, seller, parseUnits(String(amountUsd), d)],
  });
  const status = STATUS[r[0]];
  return {
    status, ok: status === "OK", remainingToday: formatUnits(r[1], d), expiry: Number(r[2]),
    erc8004Id: r[3].toString(), account: r[4] === "0x0000000000000000000000000000000000000000" ? null : r[4], reason: REASONS[status],
  };
}

// ---------------------------------------------------------------- x402-style gate

/** A request reference both sides can derive: binds the payment to this seller, this resource and this nonce. */
export const paymentRef = (seller: Address, resource: string, nonce: string) =>
  keccak256(toHex(`leash:${seller.toLowerCase()}:${resource}:${nonce}`));

/** Message an agent signs to prove it controls the agent key named in x-leash-agent. */
export const proofMessage = (resource: string, nonce: string) => `leash:${resource}:${nonce}`;

export type GateRequest = { method: string; url: string; headers: Record<string, string | string[] | undefined> };
export type GateResult =
  | { allow: true; agent: Address; paid: string; tx: Hex; verdict: Verdict; review?: Hex }
  | { allow: false; status: 402 | 403; body: Record<string, unknown> };

/**
 * Framework-agnostic gate. Call it with the incoming request; serve on allow, otherwise reply with status+body.
 *
 *   1st request: no payment header -> 402 with price, payTo, ref and the agent's live leash verdict
 *   agent pays through its Leash (one tx), then retries with x-leash-payment: <txHash>
 *   2nd request: the gate checks the receipt's Paid event (agent, seller, amount >= price, ref) -> allow
 */
export type GateConfig = {
  seller: Address; priceUsd: string; resource?: string;
  /** Refuse payments mined longer ago than this (default 300 s). Limits how long one payment proof stays usable. */
  maxPaymentAgeSeconds?: number;
  /** Record a payment as used; return false if it was already used. Plug in your store (Redis, a DB row) so one
   *  payment buys exactly one response. Without it, a payment can be replayed until it is maxPaymentAgeSeconds old. */
  claim?: (tx: Hex) => boolean | Promise<boolean>;
  /** Tokens you accept as payment. Default: the network's USDC only (the Leash test dollar where a network has no
   *  USDC). A leash can name any ERC-20, so without this check an agent could "pay" in a token worth nothing. The test
   *  dollar is free to mint by design (it powers the demo), so list it explicitly only if you want demo payments. */
  acceptTokens?: Address[];
  /** The seller's key. When set, the gate leaves an ERC-8004 review of each agent it serves ("paid"), so an agent's
   *  track record lives in Monad's Reputation Registry, signed by the sellers who dealt with it. */
  review?: Account;
  /** Also review agents the leash refused (tag2 = the refusal, e.g. "over_cap"). Return true to review this one;
   *  use it to rate-limit, since anyone can send a refused agent's headers. Default: never. */
  reviewRefusals?: (agent: Address, status: LeashStatus) => boolean;
  /** Your ERC-8004 agent id. Sent in the 402 as `sellerAgentId`, so an agent with a `sellerPolicy` can check your
   *  bond before it pays. The agent verifies on chain that this id belongs to `seller`, so it can't be borrowed. */
  agentId?: string | bigint;
} & Options;

const sellerId = (cfg: GateConfig) => (cfg.agentId !== undefined ? { sellerAgentId: String(cfg.agentId) } : {});

export async function leashGate(req: GateRequest, cfg: GateConfig): Promise<GateResult> {
  const h = (k: string) => { const v = req.headers[k] ?? req.headers[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
  const resource = cfg.resource ?? new URL(req.url, "http://x").pathname;
  const agent = h("x-leash-agent") as Address | undefined;
  const nonce = h("x-leash-nonce"), sig = h("x-leash-proof") as Hex | undefined;
  if (!agent || !nonce || !sig) {
    return { allow: false, status: 402, body: { error: "payment_required", price: cfg.priceUsd, payTo: cfg.seller, network: net(cfg).chainId, ...sellerId(cfg), howTo: "Send x-leash-agent, x-leash-nonce and x-leash-proof (agent signature over 'leash:<resource>:<nonce>')." } };
  }
  if (!(await verifyMessage({ address: agent, message: proofMessage(resource, nonce), signature: sig }))) {
    return { allow: false, status: 403, body: { error: "bad_proof", reason: "The signature doesn't match x-leash-agent." } };
  }
  const ref = paymentRef(cfg.seller, resource, nonce);
  const payment = h("x-leash-payment") as Hex | undefined;
  if (!payment) {
    const verdict = await checkAgent(agent, cfg.seller, cfg.priceUsd, cfg);
    let review: Hex | undefined;
    if (!verdict.ok && cfg.review && verdict.erc8004Id !== "0" && cfg.reviewRefusals?.(agent, verdict.status)) {
      review = await reviewAgent(cfg.review, { agentId: verdict.erc8004Id, outcome: "refused", status: verdict.status, endpoint: resource }, cfg).catch(() => undefined);
    }
    return { allow: false, status: verdict.ok ? 402 : 403, body: { error: verdict.ok ? "payment_required" : "leash_refused", price: cfg.priceUsd, payTo: cfg.seller, ref, ...sellerId(cfg), leash: verdict, ...(review ? { review } : {}) } };
  }
  const client = clientFor(cfg);
  const rc = await client.getTransactionReceipt({ hash: payment }).catch(() => null);
  if (!rc || rc.status !== "success") return { allow: false, status: 402, body: { error: "payment_not_found", ref } };
  const mined = await client.getBlock({ blockNumber: rc.blockNumber });
  if (Date.now() / 1000 - Number(mined.timestamp) > (cfg.maxPaymentAgeSeconds ?? 300)) {
    return { allow: false, status: 402, body: { error: "payment_expired", ref, reason: "That payment is too old to use again. Pay for this request." } };
  }
  const d = cfg.decimals ?? 6, need = parseUnits(cfg.priceUsd, d);
  for (const log of rc.logs) {
    try {
      const ev = decodeEventLog({ abi: accountAbi, data: log.data, topics: log.topics });
      if (ev.eventName !== "Paid") continue;
      const a = ev.args;
      const account = await client.readContract({ address: net(cfg).hub, abi: hubAbi, functionName: "accountOf", args: [agent] });
      const accepted = (cfg.acceptTokens ?? [net(cfg).usdc ?? net(cfg).testUsd]).filter(Boolean).map((t) => t!.toLowerCase());
      if (!accepted.includes(a.token.toLowerCase())) {
        return { allow: false, status: 402, body: { error: "token_not_accepted", ref, reason: "That payment was in a token this seller doesn't accept." } };
      }
      if (log.address.toLowerCase() === account.toLowerCase() && a.agent.toLowerCase() === agent.toLowerCase()
        && a.seller.toLowerCase() === cfg.seller.toLowerCase() && a.amount >= need && a.ref === ref) {
        if (cfg.claim && !(await cfg.claim(payment))) {
          return { allow: false, status: 402, body: { error: "payment_used", ref, reason: "That payment was already used. Pay for this request." } };
        }
        const verdict = await checkAgent(agent, cfg.seller, "0", cfg);
        const paid = formatUnits(a.amount, d);
        const review = cfg.review && verdict.erc8004Id !== "0"
          ? await reviewAgent(cfg.review, { agentId: verdict.erc8004Id, outcome: "paid", endpoint: resource, payment }, cfg).catch(() => undefined)
          : undefined;
        return { allow: true, agent, paid, tx: payment, verdict, ...(review ? { review } : {}) };
      }
    } catch { /* not our event */ }
  }
  return { allow: false, status: 402, body: { error: "payment_mismatch", ref } };
}

// ---------------------------------------------------------------- ERC-8004 reputation

/** tag1 on every review Leash writes, so anyone can filter for them. */
export const REVIEW_TAG = "leash";

export type Review = {
  agentId: string | bigint;
  /** "paid": served after a payment inside the leash (value 1). "refused": the leash said no (value 0). */
  outcome: "paid" | "refused";
  /** For refusals: why (becomes tag2, e.g. "over_cap"). */
  status?: LeashStatus;
  /** The resource the agent asked for. */
  endpoint?: string;
  /** The payment transaction, linked from the review and stored as its hash. */
  payment?: Hex;
};

/** Leave an ERC-8004 review of an agent, as the seller, in Monad's Reputation Registry. Returns the transaction hash
 *  once it is broadcast; it doesn't wait for inclusion, so it adds little to a response. */
export async function reviewAgent(seller: Account, r: Review, o: Options = {}): Promise<Hex> {
  const n = net(o);
  if (!n.reputationRegistry) throw new Error("No ERC-8004 Reputation Registry on this network");
  const w = createWalletClient({ account: seller, transport: http(n.rpc), chain: chainOf(n) });
  const tag2 = r.outcome === "paid" ? "paid" : (r.status ?? "refused").toLowerCase();
  return w.writeContract({
    address: n.reputationRegistry, abi: reputationAbi, functionName: "giveFeedback",
    args: [BigInt(r.agentId), r.outcome === "paid" ? 1n : 0n, 0, REVIEW_TAG, tag2, r.endpoint ?? "",
      r.payment ? `${n.explorer}/tx/${r.payment}` : "", r.payment ?? zeroHash],
  });
}

export type Reputation = {
  /** Leash reviews on record for this agent (not revoked). */
  reviews: number;
  /** How many different sellers left them. */
  reviewers: number;
  paid: number;
  refused: number;
};

/** An agent's Leash track record from ERC-8004: how many sellers reviewed it, how often it paid, how often its leash
 *  said no. Pass `reviewers` to count only sellers you trust (anyone can write a review). */
export async function agentReputation(agentId: string | bigint, o: Options & { reviewers?: Address[] } = {}): Promise<Reputation> {
  const n = net(o), c = clientFor(o), id = BigInt(agentId);
  const none = { reviews: 0, reviewers: 0, paid: 0, refused: 0 };
  if (!n.reputationRegistry || id === 0n) return none;
  const clients = o.reviewers ?? (await c.readContract({ address: n.reputationRegistry, abi: reputationAbi, functionName: "getClients", args: [id] }));
  if (!clients.length) return none;
  const r = await c.readContract({ address: n.reputationRegistry, abi: reputationAbi, functionName: "readAllFeedback", args: [id, [...clients], REVIEW_TAG, "", false] });
  const paid = r[5].filter((t) => t === "paid").length;
  return { reviews: r[5].length, reviewers: new Set(r[0].map((x) => x.toLowerCase())).size, paid, refused: r[5].length - paid };
}

// ---------------------------------------------------------------- agent side

/** Pay a seller from inside the leash. Reverts on-chain (and throws here) if it would break the leash. */
export async function payWithLeash(agentAccount: Account, seller: Address, amountUsd: string, ref: Hex, o: Options & { gas?: bigint } = {}) {
  const n = net(o), client = clientFor(o);
  const account = await client.readContract({ address: n.hub, abi: hubAbi, functionName: "accountOf", args: [agentAccount.address] });
  if (account === "0x0000000000000000000000000000000000000000") throw new Error("This agent has no leash");
  const w = createWalletClient({ account: agentAccount, transport: http(n.rpc), chain: chainOf(n) });
  const hash = await w.writeContract({ address: account, abi: accountAbi, functionName: "pay", args: [seller, parseUnits(amountUsd, o.decimals ?? 6), ref], gas: o.gas ?? 150_000n });
  const rc = await client.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw Object.assign(new Error("Refused on-chain by the leash"), { hash });
  return hash;
}

/** fetch() for agents: on a 402 from a Leash gate, pays inside the leash and retries once.
 *  With `sellerPolicy`, it first checks the seller's bond and returns a 402 `seller_policy` without paying if the
 *  seller fails it. Off unless you pass it. */
export async function fetchWithLeash(url: string, agentAccount: Account & { signMessage: NonNullable<Account["signMessage"]> }, init: RequestInit & Options & { sellerPolicy?: SellerPolicy } = {}) {
  const resource = new URL(url).pathname, nonce = toHex(crypto.getRandomValues(new Uint8Array(12)));
  const proof = await agentAccount.signMessage({ message: proofMessage(resource, nonce) });
  const headers = { ...(init.headers as Record<string, string>), "x-leash-agent": agentAccount.address, "x-leash-nonce": nonce, "x-leash-proof": proof };
  const first = await fetch(url, { ...init, headers });
  if (first.status !== 402) return first;
  const body = await first.json();
  if (!body.ref || !body.payTo) return new Response(JSON.stringify(body), { status: 402 });
  if (init.sellerPolicy) {
    const seller = await checkSeller(body.payTo, body.sellerAgentId, { ...init.sellerPolicy, client: init.sellerPolicy.client ?? init.client });
    if (!seller.ok) return new Response(JSON.stringify({ error: "seller_policy", payTo: body.payTo, ...seller }), { status: 402 });
  }
  const tx = await payWithLeash(agentAccount, body.payTo, body.price, body.ref, init);
  return fetch(url, { ...init, headers: { ...headers, "x-leash-payment": tx } });
}
