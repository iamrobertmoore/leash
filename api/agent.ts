// GET ?agent= -> an agent's track record from the Envio indexer: what it has paid, to how many sellers, since when,
// and how its owner's other agents have fared. The on-chain check says what the agent may do now; this says what it has done.
import { getAddress } from "viem";

const Q = `query ($a: String!) {
  Agent_by_pk(id: $a) { erc8004Id paymentCount totalPaid revoked leashedAt hasBrief
    account { id agentCount agents { revoked } } }
  Payment(where: { agent_id: { _eq: $a } }, distinct_on: seller_id) { seller_id } }`;

export default async function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");
  const url = process.env.ENVIO_URL;
  if (!url) return res.status(503).end(JSON.stringify({ error: "indexer not configured" }));
  let a: string;
  try { a = getAddress(String(req.query?.agent ?? "")); } catch { return res.status(400).end(JSON.stringify({ error: "agent must be an address" })); }
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: Q, variables: { a } }) });
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0]?.message);
    const g = j.data.Agent_by_pk;
    res.setHeader("cache-control", "public, s-maxage=5, stale-while-revalidate=30");
    if (!g) return res.status(200).end(JSON.stringify({ agent: a, known: false }));
    res.status(200).end(JSON.stringify({
      agent: a, known: true, erc8004Id: g.erc8004Id, leashedAt: g.leashedAt, revoked: g.revoked, hasBrief: g.hasBrief,
      payments: g.paymentCount, paidUsd: Number(g.totalPaid) / 1e6, sellersPaid: j.data.Payment.length,
      owner: { account: g.account.id, agents: g.account.agentCount, revoked: g.account.agents.filter((x: any) => x.revoked).length },
      source: "Envio HyperIndex",
    }));
  } catch (e: any) {
    res.status(502).end(JSON.stringify({ error: e?.message ?? String(e) }));
  }
}
