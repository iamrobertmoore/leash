// app/api/answer/route.ts in a Next.js app. npm i leash-monad viem
import { leashGate } from "leash-monad";

export async function GET(req: Request) {
  const g = await leashGate(
    { method: req.method, url: req.url, headers: Object.fromEntries(req.headers) },
    { seller: process.env.SELLER as `0x${string}`, priceUsd: "0.25", claim: async (tx) => markUsedOnce(tx) },
  );
  if (!g.allow) return Response.json(g.body, { status: g.status });
  return Response.json({ answer: 42, paid: g.paid, tx: g.tx });
}

// One payment buys one response: record the tx hash (unique constraint) and return false if it was already there.
declare function markUsedOnce(tx: string): Promise<boolean>;
