// `npx leash-monad verify`: checks Leash's public claims against Monad mainnet, live. Reads only; no keys, no funds.
import crypto from "node:crypto";
import { createPublicClient, http, parseAbi, toHex, concat, keccak256, decodeFunctionData, decodeErrorResult, decodeEventLog, type Address, type Hex } from "viem";
import proofs from "../../docs/proofs.json";
import reviews from "../../docs/reviews.json";

const RPC = process.env.LEASH_RPC ?? "https://rpc.monad.xyz";
const SITE = "https://leash-monad.vercel.app";
const EXPLORER = "https://monadvision.com/tx/";
const HUB = "0x64a489074dd6a4b3b977e5f635a178366a8c12c3" as Address;
const IMPL = "0xe39E32C8c834B06d8Ca9f5f2120BC042242D053a" as Address;
const TUSD = "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3" as Address;
const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address;
const P256 = "0x0000000000000000000000000000000000000100" as Address;
const DEMO_ACCOUNT = "0xdE69C70Ed03Cf585800044030275c00d9E74538C" as Address;
const DEMO_AGENT_ID = 10299n;
const REPUTATION = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address;
const SELLER = "0xFB331d9DB7f6F25DCBcCF9a2Bd86986198F07bA5" as Address; // the live paid API's payTo

const errors = parseAbi([
  "error UnknownAgent()", "error AgentRevoked()", "error LeashExpired(uint64 expiry)",
  "error SellerNotAllowed(address seller)", "error OverCap(uint256 remainingToday, uint256 attempted)",
]);
const payAbi = parseAbi(["function pay(address seller, uint256 amount, bytes32 ref)"]);

export async function verify(log: (s: string) => void = console.log): Promise<number> {
  const pub = createPublicClient({ transport: http(RPC) });
  let failed = 0;
  const ok = (name: string, pass: boolean, detail = "") => { log(`${pass ? "✓" : "✗"} ${name}${detail ? "  · " + detail : ""}`); if (!pass) failed++; };
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { ok(name, false, (e?.shortMessage ?? e?.message ?? String(e)).slice(0, 120)); } };

  log("Leash: checking every claim against Monad mainnet\n");
  await step("Monad mainnet", async () => ok("Monad mainnet (chain 143)", (await pub.getChainId()) === 143));

  log("\nContracts");
  for (const [name, a] of [["LeashHub", HUB], ["LeashAccount implementation", IMPL], ["tUSD (demo dollar)", TUSD]] as const) {
    await step(name, async () => {
      const code = await pub.getCode({ address: a });
      const r = await fetch(`https://sourcify-api-monad.blockvision.org/v2/contract/143/${a}`).then((x) => x.json()).catch(() => null);
      const m = r?.match ?? r?.runtimeMatch;
      ok(`${name} deployed, source verified (${m ?? "unknown"})`, !!code && code !== "0x" && (m === "match" || m === "exact_match"), a);
    });
  }
  await step("Hub clones that implementation", async () => {
    const impl = await pub.readContract({ address: HUB, abi: parseAbi(["function implementation() view returns (address)"]), functionName: "implementation" });
    ok("Hub clones that implementation", impl.toLowerCase() === IMPL.toLowerCase());
  });

  log("\nOne allowed payment, then one refusal per rule (real transactions, reverted inside LeashAccount.pay)");
  for (const p of proofs.rows) {
    await step(p.case, async () => {
      const hash = p.hash as Hex;
      const [tx, rc] = await Promise.all([pub.getTransaction({ hash }), pub.getTransactionReceipt({ hash })]);
      const isPay = decodeFunctionData({ abi: payAbi, data: tx.input }).functionName === "pay" && tx.to?.toLowerCase() === proofs.account.toLowerCase();
      if (p.expect === "paid") return ok(`${p.case.padEnd(13)} $${p.amountUsd} paid`, isPay && rc.status === "success", EXPLORER + hash);
      // Replay the same call against the state just before its block to read the contract's own revert reason.
      let reason = "unknown";
      try { await pub.call({ to: tx.to!, data: tx.input, account: tx.from, blockNumber: rc.blockNumber - 1n }); reason = "did not revert"; }
      catch (e: any) {
        const data = e?.cause?.data ?? e?.cause?.cause?.data ?? e?.data;
        try { reason = decodeErrorResult({ abi: errors, data }).errorName; } catch { /* keep unknown */ }
      }
      ok(`${p.case.padEnd(13)} refused: ${reason}`, isPay && rc.status === "reverted" && reason === p.expect, EXPLORER + hash);
    });
  }

  log("\nSellers review agents in ERC-8004 (Monad's Reputation Registry)");
  const feedbackAbi = parseAbi(["event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)"]);
  for (const [label, r, tag2] of [["after serving it", reviews.paid.review, "paid"], ["after refusing it", reviews.refused.review, String(reviews.refused.status).toLowerCase()]] as const) {
    await step(label, async () => {
      const rc = await pub.getTransactionReceipt({ hash: r as Hex });
      const ev = rc.logs.filter((l) => l.address.toLowerCase() === REPUTATION.toLowerCase()).map((l) => { try { return decodeEventLog({ abi: feedbackAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find(Boolean) as any;
      const a = ev?.args;
      ok(`The paid API reviewed agent #${reviews.agentId} ${label}: ${a?.tag1}/${a?.tag2}`, rc.status === "success" && a?.agentId === BigInt(reviews.agentId)
        && a?.clientAddress.toLowerCase() === SELLER.toLowerCase() && a?.tag1 === "leash" && a?.tag2 === tag2, EXPLORER + r);
    });
  }

  log("\nPasskeys and identity");
  await step("P256", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const msg = Buffer.from("leash verify");
    const hash = crypto.createHash("sha256").update(msg).digest();
    const sig = crypto.sign("sha256", msg, { key: privateKey, dsaEncoding: "ieee-p1363" });
    const xy = (b: string) => Buffer.from(b, "base64url");
    const input = concat([toHex(hash), toHex(sig.subarray(0, 32)), toHex(sig.subarray(32)), toHex(xy(jwk.x)), toHex(xy(jwk.y))]);
    const good = await pub.call({ to: P256, data: input });
    const bad = await pub.call({ to: P256, data: (input.slice(0, 2) + "ff" + input.slice(4)) as Hex });
    ok("P256 precompile at 0x0100 accepts a passkey signature and rejects a tampered one", BigInt(good.data ?? "0x0") === 1n && (!bad.data || bad.data === "0x"));
  });
  await step("ERC-8004", async () => {
    const owner = await pub.readContract({ address: IDENTITY, abi: parseAbi(["function ownerOf(uint256) view returns (address)"]), functionName: "ownerOf", args: [DEMO_AGENT_ID] });
    ok(`ERC-8004 agent #${DEMO_AGENT_ID} is owned by its passkey account`, owner.toLowerCase() === DEMO_ACCOUNT.toLowerCase(), owner);
  });
  await step("Seller check", async () => {
    const c = await pub.readContract({ address: HUB, abi: parseAbi(["function check(address,address,uint256) view returns (uint8,uint256,uint64,uint256,address)"]), functionName: "check", args: [keccak256(toHex("nobody")).slice(0, 42) as Address, DEMO_ACCOUNT, 1n] });
    ok("Seller check answers UNKNOWN_AGENT for a key with no leash", c[0] === 1);
  });

  log("\nLive pieces");
  await step("Paid API", async () => ok("Paid API answers 402 without payment", (await fetch(`${SITE}/api/forecast`)).status === 402, `${SITE}/api/forecast`));
  await step("Envio", async () => {
    const n = await fetch(`${SITE}/api/network`).then((x) => x.json());
    ok("Envio indexer serves the network view", !!n?.Stats?.[0], n?.Stats?.[0] ? `${n.Stats[0].agentsLeashed} agents, ${n.Stats[0].payments} payments` : "");
  });
  for (const pkg of ["leash-monad", "leash-monad-mcp"]) {
    await step(pkg, async () => { const v = await fetch(`https://registry.npmjs.org/${pkg}/latest`).then((x) => x.json()); ok(`npm: ${pkg} is published`, !!v?.version, v?.version); });
  }

  log(failed ? `\n${failed} check(s) failed` : "\nAll claims check out.");
  return failed;
}
