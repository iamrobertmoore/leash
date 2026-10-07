// The demo seller: a real paid API ("Monad block & gas forecast", $1 a call) behind the Leash gate.
import { keccak256, encodePacked, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { leashGate, paymentRef, proofMessage, checkAgent, payWithLeash } from "../sdk/src/index";
import { NET } from "./config";
import { pub, demoKeys } from "./relayer";
import { accountAbi } from "./abi";

export const network = NET.chain.id === 143 ? "mainnet" : "testnet";
export const PRICE = "1";
export const RESOURCE = "/api/forecast";
export function sellerAddress(): Address {
  const seed = process.env.AGENT_SEED!;
  return privateKeyToAccount(keccak256(encodePacked(["string", "string"], [seed, "demo-seller"]))).address;
}

export async function forecast() {
  const [block, gas] = await Promise.all([pub.getBlockNumber(), pub.getGasPrice()]);
  return { block: block.toString(), gasPriceGwei: Number(gas) / 1e9, next10BlocksInSeconds: 4, note: "Paid for through a Leash, verified on Monad." };
}

// One payment buys one forecast. This demo keeps used payments in memory (per serverless instance) and refuses any
// payment older than 5 minutes; a production seller passes a claim() backed by its database.
const used = new Set<string>();
const claim = (tx: string) => (used.has(tx) ? false : (used.add(tx), true));
export async function gate(req: { method: string; url: string; headers: Record<string, any> }) {
  return leashGate(req, { seller: sellerAddress(), priceUsd: PRICE, resource: RESOURCE, network, claim, maxPaymentAgeSeconds: 300 });
}

/** The judge's agent buys one forecast the honest way: 402, pay inside the leash, retry, 200. Every stage is returned. */
export async function buyOnce(account: Address, baseUrl: string) {
  const list = await pub.readContract({ address: account, abi: accountAbi, functionName: "agents" });
  if (!list.length) throw new Error("agent is not leashed yet");
  const { agent } = demoKeys(account, list.length - 1);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(12)));
  const proof = await agent.signMessage({ message: proofMessage(RESOURCE, nonce) });
  const headers = { "x-leash-agent": agent.address, "x-leash-nonce": nonce, "x-leash-proof": proof };
  const url = new URL(RESOURCE, baseUrl).toString();
  const first = await fetch(url, { headers });
  const firstBody = await first.json();
  if (first.status !== 402) return { stage: "refused-before-pay", status: first.status, body: firstBody };
  let tx: string;
  try { tx = await payWithLeash(agent, firstBody.payTo, firstBody.price, firstBody.ref, { network }); }
  catch (e: any) { return { stage: "payment-refused", status: 402, body: firstBody, error: e.message, tx: e.hash }; }
  const second = await fetch(url, { headers: { ...headers, "x-leash-payment": tx } });
  return { stage: "served", status: second.status, first: { status: first.status, leash: firstBody.leash }, tx, body: await second.json() };
}
export { paymentRef, checkAgent };
