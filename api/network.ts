// GET -> network totals, recent payments and top sellers from the Envio HyperIndex indexer.
// One fixed query, served from Vercel's edge cache, so any number of viewers costs Envio at most a few queries a minute.
const Q = `{ Stats(where:{id:{_eq:"all"}}){ agentsLeashed agentsRevoked payments totalPaid briefsSealed }
  Payment(order_by:{block:desc}, limit:6){ amount timestamp txHash agent_id seller_id }
  Seller(order_by:{totalReceived:desc}, limit:6){ id totalReceived paymentCount agentsServed } }`;

export default async function handler(_req: any, res: any) {
  res.setHeader("content-type", "application/json");
  const url = process.env.ENVIO_URL;
  if (!url) return res.status(503).end(JSON.stringify({ error: "indexer not configured" }));
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: Q }) });
    const j = await r.json();
    if (!j?.data?.Stats?.[0]) throw new Error(j?.errors?.[0]?.message ?? "no data");
    res.setHeader("cache-control", "public, s-maxage=10, stale-while-revalidate=60");
    res.status(200).end(JSON.stringify({ ...j.data, indexer: url }));
  } catch (e: any) {
    res.status(502).end(JSON.stringify({ error: e?.message ?? String(e) }));
  }
}
