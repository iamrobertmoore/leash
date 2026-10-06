import { gate, forecast } from "../server/seller";
// A real paid endpoint ($1 per call) protected by the Leash gate. Agents get a 402 until they pay inside their leash.
export default async function handler(req: any, res: any) {
  res.setHeader("content-type", "application/json");
  try {
    const g = await gate({ method: req.method, url: req.url, headers: req.headers });
    if (!g.allow) return res.status(g.status).end(JSON.stringify(g.body));
    return res.status(200).end(JSON.stringify({ paid: g.paid, tx: g.tx, leashAfter: g.verdict, forecast: await forecast() }));
  } catch (e: any) { return res.status(500).end(JSON.stringify({ error: e?.shortMessage ?? e?.message })); }
}
