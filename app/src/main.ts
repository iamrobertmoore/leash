import { createScene } from "./tether";
import { NET, STATUS } from "./config";
import { createPasskey, demoSigner, passkeySupported, resumePasskey, savedCredentialId, type Signer } from "./passkey";
import { sealBrief } from "./brief";
import { setupAccount, leashAgent, runAttack, revokeAgent, sellerCheck, agentHistory, watch, buyForecast, setBrief, type Setup } from "./chain";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const scene = createScene($("scene") as HTMLCanvasElement);
const short = (h: string) => h.slice(0, 6) + "…" + h.slice(-4);
const tx = (h: string) => `<a href="${NET.explorer}/tx/${h}" target="_blank" rel="noopener">${short(h)} ↗</a>`;
const addr = (a: string) => `<a href="${NET.explorer}/address/${a}" target="_blank" rel="noopener">${short(a)} ↗</a>`;
$("net").textContent = NET.name.toUpperCase();
scene.onBlock((n) => ($("blk").textContent = n.toLocaleString()));

function stats() { const s = scene.stats(); $("sTwin").textContent = `$${s.twinBal.toFixed(2)}`; $("sSpent").textContent = `$${s.spent.toFixed(2)}`; $("sRef").textContent = String(s.refused); }

// receipts often land together; play them one at a time so each refusal reads
const queue: (() => void)[] = []; let qBusy = false;
function enqueue(f: () => void) { queue.push(f); if (!qBusy) drain(); }
async function drain() { qBusy = true; while (queue.length) { queue.shift()!(); stats(); await new Promise((r) => setTimeout(r, 170)); } qBusy = false; }

// ---------- idle: replay a real recorded run, paced at Monad's block time
let live = false;
type Ev = { kind: "leashed" | "twin"; ok: boolean; block: number; hash: string };
async function replayLoop() {
  const rec = await fetch("/replay.json").then((r) => r.json()).catch(() => null);
  if (!rec) return;
  const first = rec.events[0].block;
  scene.setLabel(`AGENT · ${short(rec.agent)}`);
  while (!live) {
    scene.reset(); stats();
    await new Promise((r) => setTimeout(r, 1500));
    for (const e of rec.events as Ev[]) {
      if (live) return;
      const wait = Math.max(0, (e.block - first) * 400 - 0);
      await new Promise((r) => setTimeout(r, Math.min(260, wait ? 140 : 60)));
      if (live) return; // the judge started a live run while we were waiting
      const rail = scene.head || e.block; // replayed events are drawn on today's rail, labelled with their real block
      if (e.kind === "twin") { if (e.ok) scene.twinSent(rail); }
      else if (e.ok) scene.paid(rail); else scene.refused(rail, e.block);
      stats();
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}
replayLoop();

// ---------- the judge flow, live on chain
let signer: Signer | null = null, setup: Setup | null = null;
const steps = [...document.querySelectorAll<HTMLLIElement>("#steps li")];
const stepOn = (n: number) => { steps.forEach((li, i) => { li.classList.toggle("on", i === n - 1); if (i < n - 1) li.classList.add("done"); }); const li = steps[n - 1], pn = $("panel"); if (li) pn.scrollTo({ top: Math.max(0, li.offsetTop - 120), behavior: "smooth" }); };
async function busy(btn: HTMLButtonElement, out: HTMLElement, fn: () => Promise<void>) {
  btn.disabled = true; btn.classList.add("busy"); const t = btn.textContent; btn.textContent = "Working…";
  try { await fn(); btn.textContent = "Done"; }
  catch (e: any) { out.innerHTML += `<div class="e">${e?.message ?? e}</div>`; btn.disabled = false; btn.textContent = t; }
  btn.classList.remove("busy");
}

$("try").onclick = async () => {
  $("steps").hidden = false; stepOn(1);
  live = true; scene.setMode("live"); scene.reset(); stats(); scene.setLabel("YOUR AGENT");
  if (!(await passkeySupported())) $("b1").textContent = "Create passkey (if your device has one)";
  const saved = resumePasskey();
  if (saved) {
    $("b1").textContent = "Use my passkey";
    $("o1").innerHTML = `Found your passkey from last time. <button class="link" id="b1new">Create a new one instead</button>`;
    $("b1new").onclick = () => busy($("b1") as HTMLButtonElement, $("o1"), async () => { signer = await createPasskey(); await afterSigner($("o1")); });
  }
};

async function afterSigner(out: HTMLElement) {
  out.innerHTML = `Passkey public key ${short(signer!.x)}… · ${signer!.kind === "demo" ? "demo key in this tab" : "your device"}<br>Creating your account on Monad…`;
  setup = await setupAccount(signer!);
  out.innerHTML += `<br>Account ${addr(setup.account)} · agent ${addr(setup.agent)}`;
  scene.setLabel(`YOUR AGENT · ${short(setup.agent)}`);
  ($("b2") as HTMLButtonElement).disabled = false; stepOn(2);
}
$("b1").onclick = () => busy($("b1") as HTMLButtonElement, $("o1"), async () => { signer = resumePasskey() ?? (await createPasskey()); await afterSigner($("o1")); });
$("b1demo").onclick = () => busy($("b1") as HTMLButtonElement, $("o1"), async () => { signer = await demoSigner(); await afterSigner($("o1")); });

$("b2").onclick = () => busy($("b2") as HTMLButtonElement, $("o2"), async () => {
  $("o2").innerHTML = "Sign with your passkey…";
  const r = await leashAgent(signer!, setup!);
  $("o2").innerHTML = `Leashed: $5.00/day, 7 days. Verified on-chain in block ${Number(r.block).toLocaleString()} · ${tx(r.hash)}`;
  ($("bBuy") as HTMLButtonElement).disabled = false; stepOn(3);
  $("briefBox").hidden = false;
  if (signer!.kind !== "passkey") { $("oBrief").innerHTML = "Needs a real passkey (the demo key can't run WebAuthn PRF)."; ($("bBrief") as HTMLButtonElement).disabled = true; }
});

$("bBrief").onclick = () => busy($("bBrief") as HTMLButtonElement, $("oBrief"), async () => {
  $("oBrief").innerHTML = "Deriving this agent's key from your passkey (WebAuthn PRF, salt leash.brief.v1:agent)…";
  const { sealed, fingerprint } = await sealBrief(setup!.agent, ($("briefText") as HTMLTextAreaElement).value, savedCredentialId());
  $("oBrief").innerHTML = `Sealed (${(sealed.length - 2) / 2} bytes, key ${fingerprint}…). Signing to store it on the agent's ERC-8004 identity…`;
  const r = await setBrief(signer!, setup!, sealed);
  $("oBrief").innerHTML = `Stored on ERC-8004 · ${tx(r.hash)}<br>No key stored anywhere. <a href="/brief.html?agent=${setup!.agent}" target="_blank" rel="noopener">Open it on another device ↗</a>`;
});

let bought = 0;
$("bBuy").onclick = () => busy($("bBuy") as HTMLButtonElement, $("oBuy"), async () => {
  $("oBuy").innerHTML = "GET /api/forecast …";
  const r = await buyForecast(setup!);
  if (r.stage !== "served") throw new Error(`Seller answered ${r.status}: ${r.body?.leash?.reason ?? r.error ?? r.body?.error}`);
  bought++; scene.paid(scene.head);
  stats();
  $("oBuy").innerHTML = `402 Payment Required · leash ${r.first.leash.status}, $${Number(r.first.leash.remainingToday).toFixed(2)} left<br>`
    + `Paid $${r.body.paid} inside the leash · ${tx(r.tx)}<br>200 OK · Monad block ${Number(r.body.forecast.block).toLocaleString()}, gas ${r.body.forecast.gasPriceGwei} gwei`
    + (r.review ? `<br>The seller reviewed your agent in ERC-8004 (paid) · ${tx(r.review)}` : "")
    + `<br>Bought ${bought} · <button class="link" id="again1">buy another</button>`;
  $("again1").onclick = () => $("bBuy").click();
  ($("bBuy") as HTMLButtonElement).disabled = false; $("bBuy").textContent = "Buy a forecast";
  ($("b3") as HTMLButtonElement).disabled = false; stepOn(4);
});

$("b3").onclick = () => busy($("b3") as HTMLButtonElement, $("o3"), async () => {
  scene.resetAttack(); stats(); $("o3").innerHTML = "Sending 40 transactions…";
  const a = await runAttack(setup!);
  let paid = 0, refused = 0, twin = 0; const firstRefusal: string[] = [];
  const show = () => ($("o3").innerHTML = `Leashed agent: ${paid} paid, ${refused} refused on-chain${firstRefusal.length ? ` · first refusal ${tx(firstRefusal[0])}` : ""}<br>Unleashed twin: $${twin} of $20 drained`);
  await Promise.all([
    watch(a.leashed, (_i, ok, block, h) => { if (ok) { paid++; enqueue(() => scene.paid(Number(block))); } else { refused++; enqueue(() => scene.refused(Number(block))); if (!firstRefusal.length) firstRefusal.push(h); }
      show(); }),
    watch(a.unleashed, (_i, ok, block) => { if (ok) { twin++; enqueue(() => scene.twinSent(Number(block))); } show(); }),
  ]);
  const c = await sellerCheck(setup!.agent, 1);
  $("o3").innerHTML += `<br>Seller check now: <b>${STATUS[c.status]}</b> · $${c.remaining.toFixed(2)} left · ERC-8004 #${c.agentId}`;
  history($("o3"), setup!.agent);
  const again = await buyForecast(setup!).catch((e) => ({ status: 0, error: e.message }));
  if (again.stage === "refused-before-pay") $("o3").innerHTML += `<br>Paid API now: <b class="red">${again.status}</b> · ${again.body.leash.reason} Refused before doing any work.${again.body.review ? ` Reviewed in ERC-8004 · ${tx(again.body.review)}` : ""}`;
  ($("b4") as HTMLButtonElement).disabled = false; stepOn(5);
});

$("b4").onclick = () => busy($("b4") as HTMLButtonElement, $("o4"), async () => {
  $("o4").innerHTML = "Sign with your passkey…";
  const r = await revokeAgent(signer!, setup!);
  scene.revoke();
  const c = await sellerCheck(setup!.agent, 1);
  $("o4").innerHTML = `Revoked in block ${Number(r.block).toLocaleString()} · ${tx(r.hash)}<br>Seller check now: <b class="red">${STATUS[c.status]}</b>`;
  history($("o4"), setup!.agent);
  steps[4].classList.add("done");
  $("o4").innerHTML += `<br><button class="link" id="again">Run it again with a fresh agent</button>`;
  $("again").onclick = () => location.reload();
});
/** What a seller can also see: the agent's track record, indexed by Envio. Appended when it arrives; skipped if the indexer is down. */
function history(el: HTMLElement, agent: string) {
  setTimeout(async () => {
    const h = await agentHistory(agent as any); if (!h?.known) return;
    const span = document.createElement("span");
    const rep = h.reputation;
    span.innerHTML = `<br>Track record (Envio): ${h.payments} payments · $${h.paidUsd.toFixed(2)} to ${h.sellersPaid} seller${h.sellersPaid === 1 ? "" : "s"}${h.revoked ? ' · <b class="red">revoked</b>' : ""}`
      + (rep?.reviews ? `<br>ERC-8004 reviews: ${rep.paid} paid, ${rep.refused} refused, from ${rep.reviewers} seller${rep.reviewers === 1 ? "" : "s"}` : "");
    el.insertBefore(span, el.querySelector("#again")?.previousSibling ?? null);
  }, 2500);
}
import("./network").then((m) => m.startNetwork());
$("foot").textContent = `Hub ${NET.hub} · ${NET.name}`;
