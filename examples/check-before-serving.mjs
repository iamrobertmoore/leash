// The smallest integration: you already charge agents some other way, and just want to refuse
// revoked, expired or over-budget agents first. npm i leash-monad viem
import { checkAgent } from "leash-monad";

export async function shouldServe(agentAddress, myAddress, priceUsd) {
  const v = await checkAgent(agentAddress, myAddress, priceUsd);
  // OK: leashed and within budget. UNKNOWN_AGENT: nobody capped it; your call whether to serve.
  return { serve: v.ok || v.status === "UNKNOWN_AGENT", reason: v.reason, leftToday: v.remainingToday };
}

if (process.argv[2]) console.log(await shouldServe(process.argv[2], process.argv[3], process.argv[4] ?? "1"));
