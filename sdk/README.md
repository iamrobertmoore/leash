# leash-monad

Spend limits for AI agents, enforced on Monad. This package is the seller and agent side of
[Leash](https://leash-monad.vercel.app): one call tells you whose agent is knocking, what it may still spend
today, and whether a payment will go through, before you do any work.

```bash
npm i leash-monad viem
```

## Check an agent (seller)

```ts
import { checkAgent } from "leash-monad";

const v = await checkAgent(agentAddress, myAddress, "2.00");   // Monad mainnet by default
if (!v.ok) return res.status(403).json(v);
// v = { status: "OK", ok: true, remainingToday: "3.0", expiry: 1791887540,
//       erc8004Id: "10299", account: "0xB1C6…", reason: "This agent is leashed and this payment fits its budget." }
```

| `status` | Meaning |
|---|---|
| `OK` | Leashed, and this payment fits today's budget |
| `UNKNOWN_AGENT` | No leash: nobody has capped this agent |
| `REVOKED` | The owner revoked it |
| `EXPIRED` | The leash ran out |
| `SELLER_NOT_ALLOWED` | The owner didn't allow this agent to pay you |
| `OVER_CAP` | This payment would break the daily limit |

It's one `eth_call` to the `LeashHub` contract. No API key, no Leash server in the path.

## Charge agents (x402-style gate)

`leashGate` is framework-agnostic. First request: 402 with your price and a payment reference. The agent pays
inside its leash (one Monad transaction) and retries with the tx hash. The gate checks the `Paid` event on-chain
(right agent, right seller, enough money, right reference) and lets it through.

```ts
import { leashGate } from "leash-monad";

app.get("/api/forecast", async (req, res) => {
  const g = await leashGate(req, { seller: MY_ADDRESS, priceUsd: "1" });
  if (!g.allow) return res.status(g.status).json(g.body);
  res.json({ paid: g.paid, tx: g.tx, data: await forecast() });
});
```

A revoked, expired or over-cap agent gets a 403 with the reason before you've done any work.

**One payment, one response.** Pass `claim` so a payment can't be replayed: it receives the payment's tx hash and
returns `false` if you've seen it before (a unique row in your database is enough). Payments older than
`maxPaymentAgeSeconds` (default 300) are refused either way, and so are payments in any token outside
`acceptTokens` (default: USDC only), because a leash can name any ERC-20. The Leash test dollar is free to mint (it
powers the demo), so add it to `acceptTokens` only if you want to take demo payments.

**The resource is the path.** The agent signs `leash:<path>:<nonce>` (for `https://api.example.com/v1/quote` that is
`leash:/v1/quote:<nonce>`), and the payment `ref` is derived from the same path. If you write your own gate, verify
against the path, not the full URL, or every honest request will fail with `bad_proof`.

```ts
const g = await leashGate(req, { seller: MY_ADDRESS, priceUsd: "1", claim: (tx) => db.insertIfNew("payments", tx) });
```

**Leave a review in ERC-8004.** Pass your seller key as `review` and the gate writes each agent it serves to Monad's
ERC-8004 Reputation Registry (`tag1 = "leash"`, `tag2 = "paid"`, linked to the payment). With `reviewRefusals` it also
records refusals (`over_cap`, `revoked`, `expired`, …); return `true` only when you want one, because anyone can replay
a refused agent's headers. Reviews are broadcast, not awaited, so they add little to the response.

```ts
const g = await leashGate(req, { seller: me.address, priceUsd: "1", review: me, reviewRefusals: oncePerAgentPerDay });

// before serving an unfamiliar agent, read what other sellers said about it
import { agentReputation } from "leash-monad";
const rep = await agentReputation(verdict.erc8004Id);            // { reviews, reviewers, paid, refused }
const trusted = await agentReputation(id, { reviewers: [a, b] });  // count only sellers you trust
```

Full examples, each runnable: [Express](../examples/express-seller.mjs), [Next.js route](../examples/next-route.ts),
[check only](../examples/check-before-serving.mjs), [agent side](../examples/agent-pays.mjs).

## Pay (agent)

```ts
import { fetchWithLeash } from "leash-monad";
import { privateKeyToAccount } from "viem/accounts";

const agent = privateKeyToAccount(AGENT_KEY);           // the session key its owner leashed
const res = await fetchWithLeash("https://leash-monad.vercel.app/api/forecast", agent);
```

On a 402 it pays inside the leash and retries once. If the leash says no, the payment reverts on-chain and
nothing leaves the account.

### Pay only bonded sellers (optional)

A leash limits how much an agent spends and, with an allow-list, who it pays by address. `sellerPolicy` adds an
allow-list by stake: the agent pays only a seller whose ERC-8004 identity has a live bond on
[Sclera](https://monadvision.com/address/0xB4d641f016f53C683c409F271eE85e136041FE3f), where an agent's owner locks
USDC against a floor on its own claim-truth rate. Off unless you pass it.

```ts
const res = await fetchWithLeash(url, agent, { sellerPolicy: { requireBond: true, minBondUsd: "0.05", minFloorBps: 8000 } });
// a seller that fails it: 402 { error: "seller_policy", reason: "no_bond", detail: "...", payTo } and nothing is paid
```

The agent checks all of this on chain before it pays, from the seller's `sellerAgentId` in the 402:

| check | refused as |
|---|---|
| the seller named an ERC-8004 id | `no_agent_id` |
| that id's owner or agent wallet is the address being paid, so a seller can't borrow another agent's bond | `not_the_payee` |
| a bond in state Active on Sclera v2, else v1 | `no_bond` |
| its window has not ended, because a matured bond can be withdrawn at any time | `bond_matured` |
| at least `minBondUsd` in USDC, a floor of at least `minFloorBps` (both optional) | `bond_too_small`, `floor_too_low` |
| the chain answered at all: an unreadable chain refuses rather than pays | `unreadable` |

A seller advertises its id with `leashGate(req, { seller, priceUsd, agentId: "10256" })`. To check a seller
without paying, call `checkSeller(payTo, sellerAgentId, { requireBond: true })`.

## Getting a leashed agent

1. `npx leash-monad-mcp --new-key` prints a fresh agent address and key (or use any key your agent already has).
2. Open [leash-monad.vercel.app/own.html](https://leash-monad.vercel.app/own.html), sign in with a passkey and leash
   that address: daily cap, sellers, expiry, demo dollars or USDC.
3. Use the key with `fetchWithLeash` / `payWithLeash`, or give it to an MCP client through
   [`leash-monad-mcp`](https://www.npmjs.com/package/leash-monad-mcp).

## Verify Leash yourself

```
npx leash-monad verify
```

Checks Leash's claims against Monad mainnet in about ten seconds. It needs no keys and only reads. It covers the
deployed and source-verified contracts, one allowed payment, and four refused payments with their on-chain revert
reasons (over cap, wrong seller, revoked, expired). It also checks the P256 precompile, the agents' ERC-8004
identities, the live paid API and the Envio indexer.

## Networks

| | Chain | LeashHub |
|---|---|---|
| `mainnet` (default) | Monad, 143 | `0x64a489074dd6a4b3b977e5f635a178366a8c12c3` |
| `testnet` | Monad Testnet, 10143 | `0x8b427106c04e66dfc6e8d58fa4de0478a54f510a` |

Pass `{ network: "testnet" }` as the last argument to any call.

MIT
