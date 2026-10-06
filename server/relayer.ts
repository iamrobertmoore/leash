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
export function demoKeys(account: Address) {
  const seed = env("AGENT_SEED");
  const k = (tag: string) => keccak256(encodePacked(["string", "address", "string"], [seed, account, tag]));
  return { agent: privateKeyToAccount(k("agent")), twin: privateKeyToAccount(k("twin")) };
}

const wait = (h: Hex) => pub.waitForTransactionReceipt({ hash: h, timeout: 30_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createAccount(x: Hex, y: Hex) {
  const account = await pub.readContract({ address: NET.hub, abi: hubAbi, functionName: "predict", args: [x, y] });
  const code = await pub.getCode({ address: account });
  if (!code || code === "0x") {
    const w = wallet();
    await wait(await w.writeContract({ address: NET.hub, abi: hubAbi, functionName: "createAccount", args: [x, y] }));
    await wait(await w.writeContract({ address: NET.token, abi: erc20Abi, functionName: "mint", args: [account, usd(DEMO.accountFundUsd)] }));
  }
  return account;
}

/** Fund the demo agent (gas) and its twin (gas + $20) ahead of the attack. */
export async function prepareAgents(account: Address) {
  const { agent, twin } = demoKeys(account);
  const w = wallet();
  const min = parseEther(DEMO.agentGasMon) / 2n;
  for (const a of [agent, twin]) await fund(a.address, min);
  const tb = await pub.readContract({ address: NET.token, abi: erc20Abi, functionName: "balanceOf", args: [twin.address] });
  if (tb < usd(DEMO.twinFundUsd)) {
    await wait(await w.writeContract({ address: NET.token, abi: erc20Abi, functionName: "mint", args: [twin.address, usd(DEMO.twinFundUsd) - tb] }));
  }
  return { agent: agent.address, twin: twin.address, token: NET.token, attacker: DEMO.attacker };
}

/** Monad's reserve-balance rule can revert a value transfer from a low-balance sender, so verify and retry. */
async function fund(to: Address, min: bigint) {
  for (let i = 0; i < 4 && (await pub.getBalance({ address: to })) < min; i++) {
    const r = await wait(await wallet().sendTransaction({ to, value: parseEther(DEMO.agentGasMon) }));
    if (r.status === "success") return;
    await sleep(1600);
  }
}

const ALLOWED_OPS = new Set(["leash", "revoke", "setCap", "setSeller"]);

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
  const hash = await wallet().writeContract({ address: account, abi: accountAbi, functionName: "ownerExecute", args: [op, a], gas: (gas * 12n) / 10n });
  const r = await wait(hash);
  return { hash, status: r.status, block: r.blockNumber.toString(), fn };
}

/** The hijack: the same 20 x $1 drain script against the leashed agent and its unleashed twin. Returns hashes at once. */
export async function attack(account: Address) {
  const { agent, twin } = demoKeys(account);
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
