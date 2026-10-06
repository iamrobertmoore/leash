# Leash indexer (Envio HyperIndex)

Indexes every Leash account, leashed agent, payment, revoke and sealed brief on **Monad mainnet** (chain 143).
Each passkey account is a clone created by `LeashHub`, so accounts are registered dynamically from
`LeashHub.AccountCreated` (see `src/handlers/leash.ts`).

Entities (`schema.graphql`): `Account`, `Agent`, `Payment`, `Seller` (with distinct agents served), and `Stats`
rolled up network-wide (`all`) and per UTC day (`day-<n>`).

The site's "Live on Monad" strip and the seller leaderboard read from this indexer's GraphQL endpoint.

```bash
npm install
npx envio dev                            # HyperSync (needs ENVIO_API_TOKEN in .env)
npx envio dev --config config.local.yaml # RPC only, no token; Monad's RPC caps eth_getLogs at 100 blocks
```

Note: refused payments revert, so they emit no events. The site counts refusals from transaction receipts instead.
