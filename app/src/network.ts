// "Live on Monad": network totals, recent payments and the seller leaderboard, from the Envio HyperIndex indexer
// (via /api/network, which caches so the free-tier query limit holds however many people are watching).
import { NET } from "./config";
const $ = (id: string) => document.getElementById(id)!;
const LABELS: Record<string, string> = {
  "0x000000000000000000000000000000000badf00d": "hijacker (capped)",
  "0xfb331d9db7f6f25dcbccf9a2bd86986198f07ba5": "/api/forecast (demo seller)",
};
const ATTACKER = "0x000000000000000000000000000000000badf00d";
const short = (a: string) => LABELS[a.toLowerCase()] ?? a.slice(0, 6) + "…" + a.slice(-4);
const usd = (v: string | number) => `$${(Number(v) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (ts: number) => { const s = Math.max(1, Math.floor(Date.now() / 1000 - ts)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

export async function startNetwork() {
  const tick = async () => {
    try {
      const r = await fetch("/api/network"); if (!r.ok) return;
      const data = await r.json(); const s = data?.Stats?.[0]; if (!s) return;
      $("network").hidden = false;
      $("nAgents").textContent = String(s.agentsLeashed); $("nPaid").textContent = usd(s.totalPaid); $("nPayments").textContent = String(s.payments);
      $("nRevoked").textContent = String(s.agentsRevoked); $("nBriefs").textContent = String(s.briefsSealed);
      $("recent").innerHTML = data.Payment.map((p: any) => `<li><span>${short(p.agent_id)} → ${short(p.seller_id)}</span><b>${usd(p.amount)}</b><a href="${NET.explorer}/tx/${p.txHash}" target="_blank" rel="noopener">${ago(p.timestamp)} ↗</a></li>`).join("");
      $("sellers2").innerHTML = data.Seller.filter((x: any) => x.id.toLowerCase() !== ATTACKER).map((x: any) => `<li><span>${short(x.id)}</span><span>${x.agentsServed} agents · ${x.paymentCount} payments</span><b>${usd(x.totalReceived)}</b></li>`).join("");
    } catch { /* indexer unreachable: keep the section hidden or stale */ }
  };
  tick(); setInterval(tick, 10000);
}
