// Small helpers shared by the API routes (Vercel Node functions).
const hits = new Map<string, number[]>();
/** Per-IP rate limit, best effort (per warm instance). */
export function limited(req: any, max = 20, windowMs = 10 * 60_000) {
  const ip = String(req.headers["x-forwarded-for"] ?? "local").split(",")[0];
  const now = Date.now(), arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}
export async function route(req: any, res: any, fn: (body: any) => Promise<unknown>, opts: { max?: number } = {}) {
  res.setHeader("content-type", "application/json");
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).end(JSON.stringify({ error: "method" }));
  if (limited(req, opts.max)) return res.status(429).end(JSON.stringify({ error: "Too many requests, try again in a few minutes." }));
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
    const out = await fn({ ...req.query, ...body });
    res.status(200).end(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  } catch (e: any) {
    res.status(400).end(JSON.stringify({ error: e?.shortMessage ?? e?.message ?? String(e) }));
  }
}
export const isHex = (s: unknown, bytes?: number) =>
  typeof s === "string" && /^0x[0-9a-fA-F]*$/.test(s) && (!bytes || s.length === 2 + bytes * 2);
