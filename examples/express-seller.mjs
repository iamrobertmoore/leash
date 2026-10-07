// A paid API in Express, gated by Leash. Run: npm i express leash-monad viem && SELLER=0xYourAddress node express-seller.mjs
import express from "express";
import { leashGate } from "leash-monad";

const SELLER = process.env.SELLER;            // where agents' payments land
const used = new Set();                        // use your database in production
const claim = (tx) => (used.has(tx) ? false : (used.add(tx), true));

const app = express();
app.get("/api/answer", async (req, res) => {
  const g = await leashGate(req, { seller: SELLER, priceUsd: "0.25", claim });
  if (!g.allow) return res.status(g.status).json(g.body);   // 402 with the price, or 403 with the leash's reason
  res.json({ answer: 42, paid: g.paid, tx: g.tx, agentLeftToday: g.verdict.remainingToday });
});
app.listen(3000, () => console.log("paid API on http://localhost:3000/api/answer"));
