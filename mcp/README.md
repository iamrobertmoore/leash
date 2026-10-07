# leash-monad-mcp

An MCP server that lets any AI agent pay for things on Monad without being able to overspend.

The agent's key lives in this server. It can only move money through its Leash account, and the Leash contract checks
the owner's limits inside every payment: a daily dollar cap, the sellers it may pay, and an expiry, all set with the
owner's passkey. So whatever the model is told, by a user or by a prompt injection, the most it can ever spend is the
daily cap.

## Tools

| Tool | What it does |
|---|---|
| `check_agent` | Would a payment of this size from this agent to this seller go through right now? `OK`, `OVER_CAP`, `REVOKED`, `EXPIRED`, `SELLER_NOT_ALLOWED` or `UNKNOWN_AGENT`, plus what's left today. Needs no key: sellers can use it too |
| `my_budget` | The agent's own leash: owner account, ERC-8004 id, dollars left today |
| `pay` | Pay a seller inside the leash. Checks first and refuses without sending anything if it would break the leash |
| `fetch_paid` | Fetch a URL that charges per call (HTTP 402, Leash gate). Pays the asked price once, inside the leash, and retries. Optional per-call price ceiling |

## Set up (two minutes)

1. Make an agent key:
   ```
   npx leash-monad-mcp --new-key
   ```
2. Open [leash-monad.vercel.app/own.html](https://leash-monad.vercel.app/own.html), sign in with your passkey and leash
   the printed address: daily cap, sellers, expiry, and tUSD (demo dollars) or real USDC.
3. Add it to your MCP client (Claude Desktop, Cursor, …):
   ```json
   {
     "mcpServers": {
       "leash": {
         "command": "npx",
         "args": ["-y", "leash-monad-mcp"],
         "env": { "LEASH_AGENT_KEY": "0x…" }
       }
     }
   }
   ```

Then ask your agent to "buy a forecast from https://leash-monad.vercel.app/api/forecast". It pays $1 inside its leash and
gets the answer. Ask it to spend more than the cap and it's refused, by the contract, not by a prompt.

## Settings

| Variable | Default | |
|---|---|---|
| `LEASH_AGENT_KEY` | none | The leashed agent's private key. Without it only `check_agent` works |
| `LEASH_NETWORK` | `mainnet` | `mainnet` (chain 143) or `testnet` (10143) |
| `LEASH_RPC`, `LEASH_HUB`, `LEASH_CHAIN_ID`, `LEASH_EXPLORER` | | Point at another deployment (used by the tests) |

## Tested

`mcp/test/e2e.ts` runs the server over stdio against a local chain with Monad's P256 precompile switched on: leash an
agent at $4/day, buy from a real Leash-gated API, pay, replay a used payment, then try to overspend every way it can. It was also run against
Monad mainnet through the live site (agent `0xD99D…992c`, ERC-8004 #10311): three paid forecasts, the fourth refused at
the cap, then refused as revoked.

MIT · part of [Leash](https://github.com/iamrobertmoore/leash)
