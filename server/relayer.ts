// The relayer pays gas so a judge needs nothing but a passkey. It can never move an account's money:
// owner actions only go through if the passkey signed them, and agents only spend inside their leash.
import {
  createPublicClient, createWalletClient, http, keccak256, encodePacked, parseUnits, parseEther,
  decodeFunctionData, toHex, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NET, DEMO } from "./config";
import { hubAbi, accountAbi, erc20Abi } from "./abi";

const usd = (n: number) => parseUnits(String(n), 6);
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };

export const pub = createPublicClient({ chain: NET.chain, transport: http() });
const relayer = () => privateKeyToAccount(env("RELAYER_KEY") as Hex);
const wallet = (acct = relayer()) => createWalletClient({ account: acct, chain: NET.chain, transport: http() });

/** Demo agent and its unleashed twin are derived from a server secret, so nothing is stored. */
export function demoKeys(account: Address, idx = 0) {
  const seed = env("AGENT_SEED");
  // index 0 keeps the original derivation; each later run gets a fresh agent and twin
  const k = (tag: string) => keccak256(encodePacked(["string", "address", "string"], [seed, account, idx ? `${tag}-${idx}` : tag]));
  return { agent: privateKeyToAccount(k("agent")), twin: privateKeyToAccount(k("twin")) };
}

const wait = (h: Hex) => pub.waitForTransactionReceipt({ hash: h, timeout: 30_000 });

/** Several judges can hit the relayer at once from different serverless instances, so relayer nonces collide.
 *  Every relayer transaction goes through here: pick the pending nonce, send, wait briefly; if the node says another
 *  tx won that nonce, or ours vanished, take a fresh nonce and send again. */
async function relay(send: (nonce: number) => Promise<Hex>) {
  const me = relayer().address;
  for (let i = 0; ; i++) {
    const nonce = await pub.getTransactionCount({ address: me, blockTag: "pending" });
    let hash: Hex | undefined;
    try {
      hash = await send(nonce);
      return await pub.waitForTransactionReceipt({ hash, timeout: 15_000 });
    } catch (e: any) {
      const msg = `${e?.details ?? ""} ${e?.shortMessage ?? e?.message ?? ""}`;
      const collided = /nonce|priority|replacement|already known|underpriced|invalid parameters/i.test(msg);
      const vanished = /Timed out/i.test(msg) && hash && !(await pub.getTransaction({ hash }).catch(() => null));
      if (i >= 5 || !(collided || vanished)) throw e;
      await sleep(300 + Math.random() * 1200);
    }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createAccount(x: Hex, y: Hex) {
  const account = await pub.readContract({ address: NET.hub, abi: hubAbi, functionName: "predict", args: [x, y] });
  const code = await pub.getCode({ address: account });
  if (!code || code === "0x") {
    const w = wallet();
    await relay((nonce) => w.writeContract({ address: NET.hub, abi: hubAbi, functionName: "createAccount", args: [x, y], nonce }));
    await relay((nonce) => w.writeContract({ address: NET.token, abi: erc20Abi, functionName: "mint", args: [account, usd(DEMO.accountFundUsd)], nonce }));
  }
  return account;
}

/** Fund the demo agent (gas) and its twin (gas + $20) ahead of the attack. */
/** How many agents this account has leashed so far (0 for a brand-new account). */
async function agentCount(account: Address) {
  const code = await pub.getCode({ address: account });
  if (!code || code === "0x") return 0;
  const list = await pub.readContract({ address: account, abi: accountAbi, functionName: "agents" });
  return list.length;
}

export async function prepareAgents(account: Address) {
  const idx = await agentCount(account); // a fresh agent for every run, so the same passkey can demo again
  const { agent, twin } = demoKeys(account, idx);
  const w = wallet();
  await fund(agent.address, parseEther(DEMO.agentGasMon));
  await fund(twin.address, parseEther(DEMO.twinGasMon));
  const tb = await pub.readContract({ address: NET.token, abi: erc20Abi, functionName: "balanceOf", args: [twin.address] });
  if (tb < usd(DEMO.twinFundUsd)) {
    await relay((nonce) => w.writeContract({ address: NET.token, abi: erc20Abi, functionName: "mint", args: [twin.address, usd(DEMO.twinFundUsd) - tb], nonce }));
  }
  return { agent: agent.address, twin: twin.address, token: NET.token, attacker: DEMO.attacker };
}

/** Monad's reserve-balance rule can revert a value transfer from a low-balance sender, so verify and retry. */
async function fund(to: Address, target: bigint) {
  for (let i = 0; i < 4; i++) {
    const bal = await pub.getBalance({ address: to });
    if (bal >= (target * 8n) / 10n) return;
    const r = await relay((nonce) => wallet().sendTransaction({ to, value: target - bal, nonce }));
    if (r.status === "success") return;
    await sleep(1600);
  }
}

const ALLOWED_OPS = new Set(["leash", "revoke", "setCap", "setSeller", "setBrief"]);

/** Submit a passkey-signed owner action. Refuses anything but leash management (no withdraw via the demo relayer). */
export async function submitOwner(account: Address, op: Hex, auth: {
  authenticatorData: Hex; clientDataJSON: string; challengeIndex: string | bigint; typeIndex: string | bigint; r: Hex; s: Hex;
}) {
  const fn = decodeFunctionData({ abi: accountAbi, data: op }).functionName;
  if (!ALLOWED_OPS.has(fn)) throw new Error(`op ${fn} not relayed`);
  const isAccount = await pub.readContract({ address: NET.hub, abi: [{ type: "function", name: "isAccount", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] }] as const, functionName: "isAccount", args: [account] });
  if (!isAccount) throw new Error("not a Leash account");
  const a = { ...auth, challengeIndex: BigInt(auth.challengeIndex), typeIndex: BigInt(auth.typeIndex) };
  const gas = await pub.estimateContractGas({ address: account, abi: accountAbi, functionName: "ownerExecute", args: [op, a], account: relayer() });
  const r = await relay((nonce) => wallet().writeContract({ address: account, abi: accountAbi, functionName: "ownerExecute", args: [op, a], gas: (gas * 12n) / 10n, nonce }));
  return { hash: r.transactionHash, status: r.status, block: r.blockNumber.toString(), fn };
}

/** The hijack: the same 20 x $1 drain script against the leashed agent and its unleashed twin. Returns hashes at once. */
export async function attack(account: Address) {
  const n = await agentCount(account);
  if (n === 0) throw new Error("agent is not leashed yet");
  const { agent, twin } = demoKeys(account, n - 1);
  const l = await pub.readContract({ address: account, abi: accountAbi, functionName: "leashes", args: [agent.address] });
  if (l[0] === "0x0000000000000000000000000000000000000000") throw new Error("agent is not leashed yet");
  const gasPrice = await pub.getGasPrice();
  const fees = { maxFeePerGas: gasPrice, maxPriorityFeePerGas: gasPrice / 50n };
  const aw = wallet(agent), tw = wallet(twin);
  let an = await pub.getTransactionCount({ address: agent.address, blockTag: "pending" });
  let tn = await pub.getTransactionCount({ address: twin.address, blockTag: "pending" });
  const leashed: Hex[] = [], unleashed: Hex[] = [];
  for (let i = 0; i < DEMO.attempts; i++) {
    const ref = toHex(`hijack-${Date.now()}-${i}`, { size: 32 });
    const [h1, h2] = await Promise.all([
      aw.writeContract({ address: account, abi: accountAbi, functionName: "pay", args: [DEMO.attacker, usd(DEMO.attemptUsd), ref], gas: DEMO.payGas, nonce: an++, ...fees }),
      tw.writeContract({ address: NET.token, abi: erc20Abi, functionName: "transfer", args: [DEMO.attacker, usd(DEMO.attemptUsd)], gas: 80_000n, nonce: tn++, ...fees }),
    ]);
    leashed.push(h1); unleashed.push(h2);
    await sleep(120);
  }
  return { agent: agent.address, twin: twin.address, leashed, unleashed, chainId: NET.chain.id };
}

export async function check(agent: Address, seller: Address, amountUsd: number) {
  const r = await pub.readContract({ address: NET.hub, abi: hubAbi, functionName: "check", args: [agent, seller, usd(amountUsd)] });
  return { status: r[0], remainingToday: r[1].toString(), expiry: r[2].toString(), agentId: r[3].toString(), account: r[4] };
}
export { NET, DEMO };
