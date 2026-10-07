// "Leash your own agent": the owner's passkey leashes any agent address (e.g. one made by leash-monad-mcp).
import { isAddress, getAddress, type Address } from "viem";
import { NET, USDC, STATUS } from "./config";
import { createPasskey, passkeySupported, resumePasskey, type Signer } from "./passkey";
import { setupOwn, leashOwn, fundOwn, revokeOwn, sellerCheck } from "./chain";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const short = (h: string) => h.slice(0, 6) + "…" + h.slice(-4);
const link = (kind: "tx" | "address", h: string) => `<a href="${NET.explorer}/${kind}/${h}" target="_blank" rel="noopener">${short(h)} ↗</a>`;
$("net").textContent = NET.name.toUpperCase();

let signer: Signer | null = null, account: Address | null = null, agent: Address | null = null;
const busy = async (b: HTMLButtonElement, out: HTMLElement, f: () => Promise<void>) => {
  b.disabled = true;
  try { await f(); } catch (e: any) { out.innerHTML = `<span class="e">${e?.message ?? e}</span>`; } finally { b.disabled = false; }
};

$("pk").onclick = () => busy($("pk") as HTMLButtonElement, $("o1"), async () => {
  if (!(await passkeySupported())) throw new Error("This browser has no passkey support. Try Chrome, Safari or Edge.");
  $("o1").textContent = "Waiting for your passkey…";
  signer = resumePasskey() ?? (await createPasskey());
  $("o1").textContent = "Setting up your account on Monad…";
  account = (await setupOwn(signer)).account;
  $("acct").innerHTML = link("address", account);
  $("o1").textContent = "Ready. Your account holds $20 of demo dollars to start.";
  $("c3").classList.remove("dim");
});

$("sign").onclick = () => busy($("sign") as HTMLButtonElement, $("o3"), async () => {
  const a = ($("agent") as HTMLInputElement).value.trim();
  if (!isAddress(a)) throw new Error("The agent address should look like 0x followed by 40 characters.");
  const cap = Math.round(Number(($("cap") as HTMLInputElement).value)), days = Math.round(Number(($("days") as HTMLInputElement).value));
  if (!(cap >= 1 && cap <= 50)) throw new Error("Pick a daily cap between $1 and $50.");
  if (!(days >= 1 && days <= 30)) throw new Error("Pick an expiry between 1 and 30 days.");
  const raw = ($("sellers") as HTMLInputElement).value.split(/[\s,]+/).filter(Boolean);
  const bad = raw.find((s) => !isAddress(s)); if (bad) throw new Error(`${bad} isn't an address.`);
  const usdc = (document.querySelector('input[name="tok"]:checked') as HTMLInputElement).value === "usdc";
  agent = getAddress(a);
  $("o3").textContent = "Sign with your passkey…";
  const r = await leashOwn(signer!, account!, { agent, token: usdc ? USDC : NET.token, capUsd: cap, days, sellers: raw.map((s) => getAddress(s)) });
  $("o3").innerHTML = `Leashed in block ${Number(r.block).toLocaleString()} · ${link("tx", r.hash)} · $${cap}/day in ${usdc ? "USDC" : "tUSD"}, ${raw.length ? raw.length + " seller" + (raw.length > 1 ? "s" : "") : "any seller"}, ${days} days`;
  if (usdc) $("o3").innerHTML += `<br>Now send USDC on Monad to your account: <b>${account}</b>`;
  const g = await fundOwn(account!, agent).catch(() => null);
  $("o3").innerHTML += g ? `<br>Agent gas: ${g.gasMon.toFixed(2)} MON` : `<br>Couldn't top up gas right now; send the agent a little MON.`;
  $("cfg").textContent = JSON.stringify({ mcpServers: { leash: { command: "npx", args: ["-y", "leash-monad-mcp"], env: { LEASH_AGENT_KEY: "0x… the key printed with this address" } } } }, null, 2);
  $("c4").classList.remove("dim");
  live(raw[0] as Address | undefined);
});

async function live(seller?: Address) {
  const c = await sellerCheck(agent!, 1, seller);
  $("live").innerHTML = `<b class="${c.status === 0 ? "" : "red"}">${STATUS[c.status]}</b> · $${c.remaining.toFixed(2)} left today · ERC-8004 #${c.agentId}`;
}

$("rev").onclick = () => busy($("rev") as HTMLButtonElement, $("o4"), async () => {
  $("o4").textContent = "Sign with your passkey…";
  const r = await revokeOwn(signer!, account!, agent!);
  $("o4").innerHTML = `Revoked in block ${Number(r.block).toLocaleString()} · ${link("tx", r.hash)}. Every seller checking this agent now sees REVOKED.`;
  await live();
});
