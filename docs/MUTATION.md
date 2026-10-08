# Mutation check

Each row breaks one safety rule in the contracts, then runs the test suite. "Caught" means at least one test failed,
so that rule is guarded. Re-run with `npx tsx scripts/mutate.ts`.

**23 of 23 mutants caught.** Last run 2026-10-08.

| The contract is changed so that… | Result |
|---|---|
| pay() skips the leash check entirely | caught (18 failing) |
| revoked agents can still pay | caught (3 failing) |
| revoke does nothing | caught (3 failing) |
| the expiry second still pays (off by one) | caught (1 failing) |
| the seller allow-list is ignored | caught (13 failing) |
| adding a seller leaves an any-seller leash open | caught (1 failing) |
| one unit over the cap still pays (off by one) | caught (3 failing) |
| spending is never counted | caught (16 failing) |
| yesterday's spending is never cleared | caught (10 failing) |
| a new day still uses yesterday's spending | caught (12 failing) |
| a signature can be replayed (nonce never moves) | caught (2 failing) |
| Face ID / Touch ID / PIN not required | caught (1 failing) |
| a signature works on any account with the same passkey | caught (1 failing) |
| a failed owner action still uses up the signature | caught (5 failing) |
| owner functions callable by anyone | caught (3 failing) |
| an account can be re-initialised (owner takeover) | caught (1 failing) |
| an agent can be leashed twice (revoke undone) | caught (1 failing) |
| a zero cap or past expiry is accepted | caught (2 failing) |
| setCap accepts a zero cap or past expiry | caught (1 failing) |
| the sealed brief has no size limit | caught (1 failing) |
| another account can take over an agent key | caught (1 failing) |
| anyone can link an agent to anything | caught (1 failing) |
| the hub's check says OK for unknown agents | caught (1 failing) |
