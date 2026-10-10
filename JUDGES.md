# Judging Leash

Everything below runs on Monad mainnet. You don't need a wallet, an account or any keys.

## Three minutes

1. **See it (about 20 s).** Open [leash-monad.vercel.app](https://leash-monad.vercel.app) and press **Hijack my own agent**.
   Create a passkey (Touch ID, Face ID, Windows Hello or a phone). If you can't, use "No passkey? Use a demo key".
   Then press each step:
   1. Sign the leash.
   2. Let the agent buy a $1 forecast from a paid API.
   3. Run the hijack: 20 drain attempts against your agent and an identical twin with no leash.
   4. Revoke.

   Every transaction links to MonadVision.
2. **Check it (about 10 s).** Run `npx leash-monad verify`. It reads every public claim from the chain, including the
   [proof table](README.md#proof-on-mainnet): one payment that goes through and four that the contract refused,
   each with its revert reason, plus the seller's ERC-8004 reviews of an agent it served and then refused. It only
   reads, so it needs no keys.
3. **Be the seller (5 s).** Run `curl -i https://leash-monad.vercel.app/api/forecast`. It answers `402` until an agent
   pays inside its leash, and `403` when the agent can't.

If you have five more minutes, put your own Claude or Cursor on a leash:

1. Run `npx leash-monad-mcp --new-key`.
2. Open [/own.html](https://leash-monad.vercel.app/own.html) and leash the key with your passkey.
3. Paste the config block it gives you into your MCP client.
4. Ask the agent to buy a forecast, then ask it to ignore its limits.

## Where to look, by criterion

| You're judging | Look at |
|---|---|
| **Does it work, end to end** | The live site and [proof table](README.md#proof-on-mainnet) (all mainnet). Two npm packages ([SDK](sdk/README.md), [MCP server](mcp/README.md)). A real paid API built on the SDK. An Envio indexer behind the network view |
| **Technical execution** | **42 contract tests** ([`test/`](test/)): every rule at its exact edge (the cap to the micro-dollar, the expiry second, UTC midnight) and every misuse of an owner signature (another op, another account, a stale nonce, no user verification). They include 1,500 random steps where the seller check must predict each payment's outcome. **Mutation check** ([`docs/MUTATION.md`](docs/MUTATION.md)): each safety rule is deleted or broken one at a time to confirm a test fails. **MCP end-to-end test** ([`mcp/test/e2e.ts`](mcp/test/e2e.ts)): a replayed payment and a wrong-token payment are refused. Threat table with code and test per row: [`docs/SECURITY.md`](docs/SECURITY.md) |
| **Monad integration** | Passkeys are verified by the P256 precompile at `0x0100` (7,282 gas, against 355,149 for a Solidity verifier). Every agent is registered in Monad's ERC-8004 Identity Registry, and sellers review the agents they serve or refuse in the ERC-8004 Reputation Registry. Per-payment enforcement is affordable at Monad fees. The site draws 400 ms blocks. [README → How Monad is used](README.md#how-monad-is-used) |
| **Design and developer experience** | `checkAgent()` is one read, `leashGate()` is one middleware call (add `review: sellerKey` and it writes ERC-8004 reviews too) ([examples/](examples/)), and putting an agent on a leash is one MCP config block. Judges need only a passkey; a relayer pays gas and can only relay what the passkey signed |
| **Track fit** | Leash is a primitive, not an app. Any seller, API or contract can ask "whose agent is this, and will this payment go through?" with one free read. The answer comes from Monad, not from a Leash server |
| **Originality** | The limit is checked inside the payment, so a hijacked or prompt-injected agent can't skip it. The owner is a passkey verified on-chain, so there's no seed phrase. Sellers can read the same leash before they serve. And the agent's private brief is sealed with a key the passkey derives (WebAuthn PRF), stored on its ERC-8004 identity |
| **Traction and path forward** | Another Monad service (ERC-8004 agent #10256) built its paid API to accept Leash payments during the hackathon, and a leashed Claude Desktop agent paid it in USDC on mainnet ([tx](https://monadvision.com/tx/0x1e911f1167978ac6dcb3504efe663038a2edcbe18775897ca5204c91bbbdb167)). Pull requests are open to add an optional Leash check to two more Monad projects that sell to agents. Both npm packages are public. [Go-to-market](README.md#built-during-monad-metropolis): sellers first, because they need the answer |

## Honest limits

- **Unaudited.** The contracts are unaudited.
- **Demo currency.** The judge demo pays in a test dollar (tUSD) on mainnet so nobody has to buy anything. Real USDC
  works on [/own.html](https://leash-monad.vercel.app/own.html) and was tested end to end with Claude Desktop.
- **Losses are capped, not prevented.** A hijacked agent can still spend that day's cap, at sellers it is allowed to pay.
- **One passkey is one owner.** There is no recovery beyond synced passkeys.

The full list is in [`docs/SECURITY.md`](docs/SECURITY.md#what-it-doesnt-do).
