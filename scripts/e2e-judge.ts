// End-to-end judge flow against a live network, using the same server functions the API routes call
// and a software passkey that produces browser-identical WebAuthn bytes.
import { encodeFunctionData, parseUnits, type Hex } from "viem";
import { softPasskey } from "../lib/webauthn";
import { createAccount, prepareAgents, submitOwner, attack, check, pub, NET } from "../server/relayer";
import { accountAbi, STATUS } from "../server/abi";

async function signOwner(pk: ReturnType<typeof softPasskey>, account: `0x${string}`, op: Hex) {
  const n = await pub.readContract({ address: account, abi: accountAbi, functionName: "nonce" });
  const digest = await pub.readContract({ address: account, abi: accountAbi, functionName: "opDigest", args: [op, n] });
  return submitOwner(account, op, pk.sign(digest));
}

async function main() {
  const t0 = Date.now();
  const pk = softPasskey({ rpId: "leash.local" });
  const account = await createAccount(pk.x, pk.y);
  const ag = await prepareAgents(account);
  console.log("account", account, "agent", ag.agent, "twin", ag.twin, `${Date.now() - t0}ms`);
  const op = encodeFunctionData({ abi: accountAbi, functionName: "leash",
    args: [ag.agent, NET.token, parseUnits("5", 6), BigInt(Math.floor(Date.now() / 1000) + 7 * 86400), [], "https://leash.demo/agent.json"] });
  console.log("leash", await signOwner(pk, account, op));
  await new Promise((r) => setTimeout(r, 3000));
  const a = await attack(account);
  console.log("attack sent", a.leashed.length, "+", a.unleashed.length, "txs");
  const rs = await Promise.all(a.leashed.map((h) => pub.waitForTransactionReceipt({ hash: h, timeout: 60_000 })));
  const ts = await Promise.all(a.unleashed.map((h) => pub.waitForTransactionReceipt({ hash: h, timeout: 60_000 })));
  const ok = rs.filter((r) => r.status === "success").length;
  console.log(`leashed: ${ok} paid, ${rs.length - ok} refused on-chain; blocks ${rs[0].blockNumber}..${rs.at(-1)!.blockNumber}`);
  console.log(`unleashed: ${ts.filter((r) => r.status === "success").length} transfers succeeded`);
  const c = await check(ag.agent, "0x000000000000000000000000000000000badF00D", 1);
  console.log("seller check after:", STATUS[c.status], c.remainingToday);
  const rv = encodeFunctionData({ abi: accountAbi, functionName: "revoke", args: [ag.agent] });
  console.log("revoke", await signOwner(pk, account, rv));
  console.log("seller check after revoke:", STATUS[(await check(ag.agent, "0x000000000000000000000000000000000badF00D", 1)).status]);
  console.log("refused hashes sample", rs.filter((r) => r.status !== "success").slice(0, 2).map((r) => r.transactionHash));
  console.log(`total ${Date.now() - t0}ms`);
  // Save the run as the landing page's replay: real hashes, real blocks.
  const ev = [
    ...rs.map((r) => ({ kind: "leashed", ok: r.status === "success", block: Number(r.blockNumber), hash: r.transactionHash })),
    ...ts.map((r) => ({ kind: "twin", ok: r.status === "success", block: Number(r.blockNumber), hash: r.transactionHash })),
  ].sort((a, b) => a.block - b.block);
  const fs = await import("node:fs");
  fs.writeFileSync("app/public/replay.json", JSON.stringify({ chainId: NET.chain.id, account, agent: ag.agent, twin: ag.twin, recorded: new Date().toISOString(), events: ev }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
