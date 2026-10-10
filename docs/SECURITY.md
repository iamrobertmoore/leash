# Leash: what it defends against, and what it costs

Leash assumes the agent will be compromised. The question is how much that can cost the owner, and whether the people
the agent pays can tell. Every row below points at the code that enforces it and the test that tries to break it.

## Threats

| If this happens | What stops it | Where | Tested in |
|---|---|---|---|
| The agent's key is stolen, or its model is prompt-injected | The key can only call `pay()`, which checks the leash in the same call: daily cap (resets 00:00 UTC), allowed sellers, expiry, revoked. At worst the attacker spends one day's cap | `LeashAccount.pay`, `_status` | `properties.test.ts` "a stolen agent key has no way out"; leash.test.ts drain script |
| The stolen key tries owner functions (raise the cap, add itself as a seller, withdraw) | Every owner function is `onlySelf`: reachable only through `ownerExecute` with a valid passkey signature | `LeashAccount.onlySelf`, `ownerExecute` | `properties.test.ts`, `leash.test.ts` "direct calls to owner functions" |
| Someone signs an owner action with a different passkey | WebAuthn verification against the account's own P-256 key, through Monad's `0x0100` precompile, with user verification required | `ownerExecute` → Solady `WebAuthn.verify` | `leash.test.ts` "wrong passkey"; `properties.test.ts` forged passkey; `rules.test.ts` "requires user verification" |
| A valid owner signature is replayed (same account, another account, another chain) | The signed digest is `keccak(chainid, account, nonce, keccak(op))`; the nonce increments on use | `LeashAccount.opDigest` | `leash.test.ts` "replayed signature"; `rules.test.ts` bound to its action, bound to its account, nonce order |
| The relayer is malicious or compromised | It can only submit what the passkey signed. It can't forge, change or replay an owner action. If it refuses to relay, the owner can submit `ownerExecute` from any address | `server/relayer.ts` `ALLOWED_OPS`; contract signature check | as above |
| An agent pays one seller it was never allowed to pay | `SellerNotAllowed` unless the leash allows any seller | `_status` | `leash.test.ts` allow-list; 1,500 random steps in `properties.test.ts` |
| The seller's check says OK but the leash changes before the payment lands | The check is advisory; `pay()` re-checks atomically. The gate only serves after it has seen the `Paid` event in a successful receipt | `sdk/src/index.ts` `leashGate` | `properties.test.ts`: check() must predict pay() at every random step |
| An agent reuses one payment to get served many times | The payment reference binds seller, resource and the agent's nonce. `claim()` marks a payment used, and payments older than 5 minutes are refused | `leashGate` `claim`, `maxPaymentAgeSeconds` | `mcp/test/e2e.ts` replayed payment refused |
| An agent "pays" in a token it minted itself (a leash can name any ERC-20) | The gate only accepts payments in tokens the seller lists; by default only the network's USDC. The Leash test dollar is free to mint by design (it powers the demo), so the demo seller lists it explicitly and real sellers shouldn't (default tightened in 0.1.6 after a report in issue #1) | `leashGate` `acceptTokens` | `mcp/test/e2e.ts` wrong token refused |
| Someone else presents the agent's payment | The request must carry the agent's signature over `leash:<resource>:<nonce>`, and the payment's `ref` must match that nonce | `leashGate` | `mcp/test/e2e.ts` |
| A refused payment is still charged | Refusals revert, so nothing moves. Monad charges gas on the gas *limit*, so the SDK sets a tight one (150k for `pay`). A refused payment cost 0.012 MON on mainnet | `payWithLeash` | mainnet tx in README |

| Someone writes fake reviews to make an agent look good (or bad) | Anyone can review in ERC-8004, so `agentReputation` reports how many distinct sellers reviewed and takes a `reviewers` list to count only sellers you trust. The registry refuses reviews from the agent's own owner | ERC-8004 Reputation Registry; `agentReputation` | `mcp/test/e2e.ts` reputation counts |
| Someone replays a refused agent's headers to make a seller spend gas on reviews | Refusal reviews are opt-in (`reviewRefusals`) and the demo seller writes at most one per agent, reason and day | `leashGate`, `server/seller.ts` | – |
| Someone tries to claim an agent key already leashed to another account | The hub links each agent key to one account; a second claim reverts `AgentTaken` | `LeashHub.link` | `rules.test.ts` "one agent key belongs to one account" |
| Someone initialises the bare implementation contract | Accounts are clones with their own storage; the implementation holds nothing and owns nothing | `LeashHub`, `initialize` | `rules.test.ts` "accounts cannot be re-initialised" |

Each rule above is also broken on purpose, one at a time, to prove a test catches it: 23 of 23 caught ([`MUTATION.md`](MUTATION.md)).

## What it doesn't do

- **It bounds loss; it doesn't prevent it.** A hijacked agent can still spend its cap, at sellers it's allowed to pay.
  Set caps for what you're willing to lose in a day.
- **The demo pays in a test dollar (tUSD).** The leash takes any ERC-20; the "Leash your own agent" page also offers
  Circle's USDC on Monad. Contracts are unaudited.
- **One passkey is one owner.** There is no recovery if the passkey is lost; synced passkeys (iCloud Keychain, Google
  Password Manager, 1Password) are the practical answer today. Funds can be withdrawn by the owner at any time, with a passkey signature (the "take your money out" step on the own-agent page).

## Gas

Measured on a local chain with the P256 precompile on (`scripts/gas-table.ts`). Mainnet figures are higher on first touch
because storage starts cold and the real ERC-8004 registry does more work.

| Action | Gas | Mainnet example |
|---|---|---|
| Create the passkey account (a clone) | 183,163 | |
| Leash an agent (passkey-signed, registers it in ERC-8004) | 394,418 | 645,814 |
| Agent pays, first payment of the day | 71,987 | 114,554 |
| Agent pays, later the same day | 54,887 | 96,456 |
| Seller check (`eth_call`, free) | 39,230 | |
| Change the cap (passkey-signed) | 66,254 | |
| Revoke (passkey-signed) | 62,765 | |
| Passkey verification alone, precompile vs Solidity verifier | 7,282 vs 355,149 | measured on mainnet |

At Monad's 102 gwei, an agent payment costs about 0.007 MON and a passkey-signed revoke about 0.006 MON.
