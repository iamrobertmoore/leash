// "Live on Monad": network totals, recent payments and the seller leaderboard, from the Envio HyperIndex indexer.
import { NET } from "./config";
const URL_ = import.meta.env.VITE_ENVIO_URL as string | undefined;
const $ = (id: string) => document.getElementById(id)!;
const LABELS: Record<string, string> = {
  "0x000000000000000000000000000000000badf00d": "attacker (demo drain)",
  "0xfb331d9db7f6f25dcbccf9a2bd86986198f07ba5": "/api/forecast (demo seller)",
};
const short = (a: string) => LABELS[a.toLowerCase()] ?? a.slice(0, 6) + "…" + a.slice(-4);
const usd = (v: string | number) => `$${(Number(v) / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (ts: number) => { const s = Math.max(1, Math.floor(Date.now() / 1000 - ts)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

const Q = `{ Stats(where:{id:{_eq:"all"}}){ agentsLeashed agentsRevoked payments totalPaid briefsSealed }
  Payment(order_by:{block:desc}, limit:6){ amount timestamp txHash agent_id seller_id }
  Seller(order_by:{totalReceived:desc}, limit:6){ id totalReceived paymentCount agentsServed } }`;

export async function startNetwork() {
  if (!URL_) return;
  const tick = async () => {
    try {
      const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: Q }) });
      const { data } = await r.json(); const s = data?.Stats?.[0]; if (!s) return;
      $("network").hidden = false;
      $("nAgents").textContent = String(s.agentsLeashed); $("nPaid").textContent = usd(s.totalPaid); $("nPayments").textContent = String(s.payments);
      $("nRevoked").textContent = String(s.agentsRevoked); $("nBriefs").textContent = String(s.briefsSealed);
      $("recent").innerHTML = data.Payment.map((p: any) => `<li><span>${short(p.agent_id)} → ${short(p.seller_id)}</span><b>${usd(p.amount)}</b><a href="${NET.explorer}/tx/${p.txHash}" target="_blank" rel="noopener">${ago(p.timestamp)} ↗</a></li>`).join("");
      $("sellers2").innerHTML = data.Seller.map((x: any) => `<li><span>${short(x.id)}</span><span>${x.agentsServed} agents · ${x.paymentCount} payments</span><b>${usd(x.totalReceived)}</b></li>`).join("");
    } catch { /* indexer unreachable: keep the section hidden or stale */ }
  };
  tick(); setInterval(tick, 5000);
}
