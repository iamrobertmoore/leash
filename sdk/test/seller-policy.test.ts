// Seller policy tests. No network: the chain is a stub that answers the four reads the policy makes.
// Run: cd sdk && npm run build && node --test --experimental-strip-types test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSeller, SCLERA } from "../src/policy.ts";
import { fetchWithLeash } from "../dist/index.mjs";

const SELLER = "0x00000000000000000000000000000000000000a1";
const STRANGER = "0x00000000000000000000000000000000000000b2";
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const HEAD = 1_000n;
const ID = 10256n;

type Bond = { state: number; postedAt?: bigint; windowBlocks?: bigint; amount?: bigint; token?: string; floor?: number };
const none: Bond = { state: 0 };
const live: Bond = { state: 1, postedAt: 900n, windowBlocks: 500n, amount: 50_000n, token: USDC, floor: 8000 };

function chain({ owner = SELLER, wallet = "0x0000000000000000000000000000000000000000", v2 = none, v1 = none, broken = false } = {}) {
  const calls: string[] = [];
  const toTuple = (b: Bond) => ({ agent: owner, postedAt: b.postedAt ?? 0n, state: b.state, token: b.token ?? "0x0000000000000000000000000000000000000000", windowBlocks: b.windowBlocks ?? 0n, amount: b.amount ?? 0n, minTruthRateBps: b.floor ?? 0, minSampleSize: 5, lastNonce: 0n });
  const client = {
    calls,
    async getBlockNumber() { return HEAD; },
    async readContract({ address, functionName }: { address: string; functionName: string }) {
      calls.push(functionName);
      if (broken) throw new Error("rpc down");
      if (functionName === "ownerOf") return owner;
      if (functionName === "getAgentWallet") return wallet;
      if (functionName === "bonds") return toTuple(address === SCLERA.v2 ? v2 : v1);
      throw new Error(`unexpected read ${functionName}: a seller policy must never reach the payment path`);
    },
  };
  return client as never as Parameters<typeof checkSeller>[2]["client"] & { calls: string[] };
}

const policy = (client: unknown, extra = {}) => ({ requireBond: true as const, client: client as never, ...extra });

test("refuses an unbonded seller", async () => {
  const v = await checkSeller(SELLER, ID, policy(chain()));
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.reason, "no_bond");
});

test("accepts a bonded seller", async () => {
  const v = await checkSeller(SELLER, ID, policy(chain({ v2: live })));
  assert.equal(v.ok, true);
  assert.equal(v.ok && v.bond.contract, SCLERA.v2);
  assert.equal(v.ok && v.bond.endsAtBlock, "1400");
});

test("reads v1 when v2 has no bond", async () => {
  const v = await checkSeller(SELLER, ID, policy(chain({ v1: live })));
  assert.equal(v.ok && v.bond.contract, SCLERA.v1);
});

test("a seller cannot borrow another agent's bond", async () => {
  const v = await checkSeller(SELLER, ID, policy(chain({ owner: STRANGER, v2: live })));
  assert.equal(!v.ok && v.reason, "not_the_payee");
});

test("the agent wallet counts as the seller, not only the owner", async () => {
  const v = await checkSeller(SELLER, ID, policy(chain({ owner: STRANGER, wallet: SELLER, v2: live })));
  assert.equal(v.ok, true);
});

test("a bond whose window has ended is not stake", async () => {
  const v = await checkSeller(SELLER, ID, policy(chain({ v2: { ...live, postedAt: 100n, windowBlocks: 500n } })));
  assert.equal(!v.ok && v.reason, "bond_matured");
});

test("slashed and released bonds do not count", async () => {
  for (const state of [2, 3]) assert.equal((await checkSeller(SELLER, ID, policy(chain({ v2: { ...live, state } })))).ok, false);
});

test("no agent id in the 402 means nothing to check, so no", async () => {
  for (const id of [undefined, "0", "abc"]) assert.equal((await checkSeller(SELLER, id as never, policy(chain({ v2: live })))).ok, false);
});

test("minimum bond and minimum floor are enforced", async () => {
  assert.equal((await checkSeller(SELLER, ID, policy(chain({ v2: live }), { minBondUsd: "0.05" }))).ok, true);
  const small = await checkSeller(SELLER, ID, policy(chain({ v2: live }), { minBondUsd: "0.06" }));
  assert.equal(!small.ok && small.reason, "bond_too_small");
  const otherToken = await checkSeller(SELLER, ID, policy(chain({ v2: { ...live, token: STRANGER } }), { minBondUsd: "0.01" }));
  assert.equal(!otherToken.ok && otherToken.reason, "bond_too_small");
  const low = await checkSeller(SELLER, ID, policy(chain({ v2: live }), { minFloorBps: 9000 }));
  assert.equal(!low.ok && low.reason, "floor_too_low");
});

test("an unreadable chain refuses rather than pays", async () => {
  const v = await checkSeller(SELLER, ID, policy(chain({ broken: true, v2: live })));
  assert.equal(!v.ok && v.reason, "unreadable");
});

// ---------------------------------------------------------------- fetchWithLeash wiring

const agent = {
  address: "0x00000000000000000000000000000000000000c3", type: "local",
  async signMessage() { return "0x" + "11".repeat(65); },
} as never;

function sellerReplying402(sellerAgentId?: string) {
  let hits = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    hits++;
    return new Response(JSON.stringify({ error: "payment_required", price: "0.01", payTo: SELLER, ref: "0x" + "22".repeat(32), ...(sellerAgentId ? { sellerAgentId } : {}) }), { status: 402 });
  }) as typeof fetch;
  return { hits: () => hits, restore: () => { globalThis.fetch = original; } };
}

test("fetchWithLeash with a policy refuses an unbonded seller before paying", async () => {
  const s = sellerReplying402(String(ID));
  const c = chain();
  try {
    const r = await fetchWithLeash("https://seller.example/api/x", agent, { sellerPolicy: policy(c) });
    assert.equal(r.status, 402);
    const body = await r.json();
    assert.equal(body.error, "seller_policy");
    assert.equal(body.reason, "no_bond");
    assert.equal(s.hits(), 1, "no retry, so no payment was attempted");
    assert.ok(!c.calls.includes("accountOf"), "the payment path was never reached");
  } finally { s.restore(); }
});

test("fetchWithLeash with a policy goes on to pay a bonded seller", async () => {
  const s = sellerReplying402(String(ID));
  const c = chain({ v2: live });
  try {
    // The stub chain refuses accountOf, so reaching the payment path shows up as that error.
    await assert.rejects(fetchWithLeash("https://seller.example/api/x", agent, { sellerPolicy: policy(c), client: c as never }), /accountOf/);
  } finally { s.restore(); }
});

test("without a policy nothing changes: no bond read at all", async () => {
  const s = sellerReplying402();
  const c = chain();
  try {
    await assert.rejects(fetchWithLeash("https://seller.example/api/x", agent, { client: c as never }), /accountOf/);
    assert.ok(!c.calls.includes("bonds"));
  } finally { s.restore(); }
});
