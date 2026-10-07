// An agent buying from a Leash-gated API. Its key must be leashed first (leash-monad.vercel.app/own.html).
// Run: npm i leash-monad viem && LEASH_AGENT_KEY=0x… node agent-pays.mjs
import { fetchWithLeash } from "leash-monad";
import { privateKeyToAccount } from "viem/accounts";

const agent = privateKeyToAccount(process.env.LEASH_AGENT_KEY);
const res = await fetchWithLeash("https://leash-monad.vercel.app/api/forecast", agent);
console.log(res.status, await res.json());   // 200 and the forecast, or 403 with the leash's reason
