# Leash

**Spend limits for AI agents, set with your passkey and enforced on Monad.**

An AI agent that can spend money is one bad prompt away from emptying its wallet. Leash gives every agent a
daily budget that the owner's passkey sets and a Monad contract checks on every single payment. Past the limit,
the chain refuses. Revoke in one tap. And any seller can read an agent's leash in one call before it gets paid.

Live on **Monad mainnet** (chain 143):

| What | Address |
|---|---|
| LeashHub (accounts + seller check) | `0xecefc8c322e2aa77327c2b4912caec04323f4f37` |
| LeashAccount implementation | `0xA0699622Fd262787bd7Fa8D3c7dB10C0c2610F8F` |
| ERC-8004 Identity Registry (Monad's) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

> Work in progress for Monad Metropolis (Trust, Identity & AI track). Full README, demo and SDK docs land this week.

## Run it

```bash
npm install
npx hardhat test          # contracts, with the P256 precompile enabled locally
npx vite build            # the site
```

## Built with AI tools

I built Leash with an AI coding agent (Claude) doing most of the typing, under my direction. Every
contract, number and claim here was checked against a test or an on-chain transaction.

## Licence

MIT
