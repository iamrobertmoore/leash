// Deploys Leash to Monad testnet against the real ERC-8004 Identity Registry, then runs one
// end-to-end proof: passkey-signed leash, two paid calls, one on-chain refusal at the cap.
import hre from "hardhat";
import fs from "node:fs";
import { encodeFunctionData, parseUnits, keccak256, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { softPasskey } from "../lib/webauthn";

// ERC-8004 Identity Registry: testnet deployment vs the mainnet one listed in Monad's docs.
const IDENTITY = hre.network.name === "monadMainnet" ? "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" : "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const usd = (n: number) => parseUnits(String(n), 6);

async function main() {
  const pc = await hre.viem.getPublicClient();
  const [deployer] = await hre.viem.getWalletClients();
  const isMain = hre.network.name === "monadMainnet";
  const out: Record<string, unknown> = isMain ? { network: "Monad Mainnet", chainId: 143, rpc: "https://rpc.monad.xyz" } : { network: "Monad Testnet", chainId: 10143, rpc: "https://testnet-rpc.monad.xyz" };
  const wait = (h: `0x${string}`) => pc.waitForTransactionReceipt({ hash: h });

  const hub = await hre.viem.deployContract("LeashHub", [IDENTITY]);
  // Reuse the demo dollar across redeploys (TOKEN=0x...), so balances and docs stay stable.
  const usdT = process.env.TOKEN
    ? await hre.viem.getContractAt("TestUSD", process.env.TOKEN as `0x${string}`)
    : await hre.viem.deployContract("TestUSD");
  out.hub = hub.address; out.implementation = await hub.read.implementation(); out.testUSD = usdT.address;

  // Demo owner: a software passkey (same WebAuthn bytes a browser produces).
  const pk = softPasskey({ rpId: "leash.demo" });
  await wait(await hub.write.createAccount([pk.x, pk.y]));
  const accountAddr = await hub.read.predict([pk.x, pk.y]);
  const account = await hre.viem.getContractAt("LeashAccount", accountAddr);
  await wait(await usdT.write.mint([accountAddr, usd(50)]));
  out.demoAccount = accountAddr;

  const agentKey = generatePrivateKey(); const agent = privateKeyToAccount(agentKey);
  const sellerKey = generatePrivateKey(); const seller = privateKeyToAccount(sellerKey);
  await wait(await deployer.sendTransaction({ to: agent.address, value: parseUnits("0.15", 18) }));
  // Monad executes asynchronously: consensus checks balances a few blocks behind, so a freshly funded
  // key has to wait a moment before it can send.
  await new Promise((r) => setTimeout(r, 4000));

  const op = encodeFunctionData({ abi: account.abi, functionName: "leash",
    args: [agent.address, usdT.address, usd(5), BigInt(Math.floor(Date.now() / 1000) + 7 * 86400), [seller.address], "https://leash.demo/agents/demo-1.json"] });
  const auth = pk.sign(await account.read.opDigest([op, await account.read.nonce()]));
  const leashTx = await account.write.ownerExecute([op, auth]);
  const lr = await wait(leashTx);
  out.leashTx = { hash: leashTx, gasUsed: lr.gasUsed.toString(), status: lr.status };
  out.agentId = (await account.read.leashes([agent.address]))[5].toString();

  const { createWalletClient, http, defineChain } = await import("viem");
  const chain = defineChain({ id: out.chainId as number, name: out.network as string, nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [out.rpc as string] } } });
  const aw = createWalletClient({ account: agent, chain, transport: http() });
  const pays: unknown[] = [];
  for (let i = 1; i <= 3; i++) {
    const args = [seller.address, usd(2), keccak256(toHex(`demo-call-${i}`))] as const;
    try {
      const gas = await pc.estimateContractGas({ address: accountAddr, abi: account.abi, functionName: "pay", args, account: agent });
      const h = await aw.writeContract({ address: accountAddr, abi: account.abi, functionName: "pay", args, gas: gas + 3000n });
      const r = await wait(h);
      pays.push({ call: i, hash: h, status: r.status, gasUsed: r.gasUsed.toString() });
    } catch (e: any) {
      // Refusal: estimate fails. Send it anyway with a fixed limit so the refusal is on-chain and visible.
      const h = await aw.writeContract({ address: accountAddr, abi: account.abi, functionName: "pay", args, gas: 90000n });
      const r = await wait(h);
      pays.push({ call: i, hash: h, status: r.status, gasUsed: r.gasUsed.toString(), note: e.shortMessage ?? String(e) });
    }
  }
  out.pays = pays;
  out.check = (await hub.read.check([agent.address, seller.address, usd(2)])).map(String);
  out.demoAgent = agent.address; out.demoSeller = seller.address;
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(isMain ? "deployments/monad-mainnet.json" : "deployments/monad-testnet.json", JSON.stringify(out, null, 2));
  // Demo keys stay in the workspace, never in the repo.
  fs.writeFileSync(isMain ? ".env.demo.mainnet" : ".env.demo", `AGENT_KEY=${agentKey}\nSELLER_KEY=${sellerKey}\n`);
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
