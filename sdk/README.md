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
`maxPaymentAgeSeconds` (default 300) are refused either way.

```ts
const g = await leashGate(req, { seller: MY_ADDRESS, priceUsd: "1", claim: (tx) => db.insertIfNew("payments", tx) });
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

## Getting a leashed agent

1. `npx leash-monad-mcp --new-key` prints a fresh agent address and key (or use any key your agent already has).
2. Open [leash-monad.vercel.app/own.html](https://leash-monad.vercel.app/own.html), sign in with a passkey and leash
   that address: daily cap, sellers, expiry, demo dollars or USDC.
3. Use the key with `fetchWithLeash` / `payWithLeash`, or give it to an MCP client through
   [`leash-monad-mcp`](https://www.npmjs.com/package/leash-monad-mcp).

## Networks

| | Chain | LeashHub |
|---|---|---|
| `mainnet` (default) | Monad, 143 | `0x64a489074dd6a4b3b977e5f635a178366a8c12c3` |
| `testnet` | Monad Testnet, 10143 | `0x8b427106c04e66dfc6e8d58fa4de0478a54f510a` |

Pass `{ network: "testnet" }` as the last argument to any call.

MIT
