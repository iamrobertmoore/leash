// Gas for every Leash action, measured on a local chain with the P256 precompile on. Run: npx hardhat node & npx tsx scripts/gas-table.ts
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseUnits, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import fs from "node:fs";
import { softPasskey } from "../lib/webauthn";
const art = (n: string) => JSON.parse(fs.readFileSync(`artifacts/contracts/${n}.sol/${n}.json`, "utf8"));
const pub = createPublicClient({ chain: hardhat, transport: http("http://127.0.0.1:8545") });
const me = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const agentA = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const w = createWalletClient({ account: me, chain: hardhat, transport: http("http://127.0.0.1:8545") });
const aw = createWalletClient({ account: agentA, chain: hardhat, transport: http("http://127.0.0.1:8545") });
const usd = (n: number) => parseUnits(String(n), 6);
const rc = async (h: Hex) => pub.waitForTransactionReceipt({ hash: h });
const dep = async (n: string, args: unknown[] = []) => (await rc(await w.deployContract({ abi: art(n).abi, bytecode: art(n).bytecode, args }))).contractAddress!;
async function main() {
const idr = await dep("MockIdentityRegistry"); const hubA = await dep("LeashHub", [idr]); const tok = await dep("TestUSD");
const hub = art("LeashHub").abi, acc = art("LeashAccount").abi, erc = art("TestUSD").abi;
const pk = softPasskey();
const g: Record<string, bigint> = {};
g.createAccount = (await rc(await w.writeContract({ address: hubA, abi: hub, functionName: "createAccount", args: [pk.x, pk.y] }))).gasUsed;
const account = await pub.readContract({ address: hubA, abi: hub, functionName: "predict", args: [pk.x, pk.y] }) as Address;
await rc(await w.writeContract({ address: tok, abi: erc, functionName: "mint", args: [account, usd(50)] }));
const owner = async (fn: string, args: unknown[]) => {
  const op = encodeFunctionData({ abi: acc, functionName: fn as any, args: args as any });
  const n = await pub.readContract({ address: account, abi: acc, functionName: "nonce" });
  const d = await pub.readContract({ address: account, abi: acc, functionName: "opDigest", args: [op, n] }) as Hex;
  return (await rc(await w.writeContract({ address: account, abi: acc, functionName: "ownerExecute", args: [op, pk.sign(d)] }))).gasUsed;
};
const now = Number((await pub.getBlock()).timestamp);
g["leash (passkey-signed, incl. ERC-8004 register)"] = await owner("leash", [agentA.address, tok, usd(5), BigInt(now + 86400), [], ""]);
await rc(await w.sendTransaction({ to: agentA.address, value: 10n ** 18n }));
g["pay, first of the day"] = (await rc(await aw.writeContract({ address: account, abi: acc, functionName: "pay", args: [me.address, usd(2), "0x" + "00".repeat(32) as Hex] }))).gasUsed;
g["pay, later the same day"] = (await rc(await aw.writeContract({ address: account, abi: acc, functionName: "pay", args: [me.address, usd(2), "0x" + "00".repeat(32) as Hex] }))).gasUsed;
g["check (seller read, eth_call)"] = await pub.estimateContractGas({ address: hubA, abi: hub, functionName: "check", args: [agentA.address, me.address, usd(1)] });
g["setCap (passkey-signed)"] = await owner("setCap", [agentA.address, usd(6), BigInt(now + 86400)]);
g["revoke (passkey-signed)"] = await owner("revoke", [agentA.address]);
for (const [k, v] of Object.entries(g)) console.log(`${k}\t${v}`);
}
main();
