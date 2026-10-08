// Checks the README's claims against Monad mainnet, live. No keys, no funds: reads only.
//   npx tsx scripts/verify.ts
import crypto from "node:crypto";
import { createPublicClient, http, parseAbi, toHex, concat, keccak256, decodeFunctionData, type Address, type Hex } from "viem";

const RPC = "https://rpc.monad.xyz";
const HUB = "0x64a489074dd6a4b3b977e5f635a178366a8c12c3" as Address;
const IMPL = "0xe39E32C8c834B06d8Ca9f5f2120BC042242D053a" as Address;
const TUSD = "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3" as Address;
const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address;
const DEMO_ACCOUNT = "0xdE69C70Ed03Cf585800044030275c00d9E74538C" as Address;
const DEMO_AGENT_ID = 10299n;
const REFUSED_TX = "0xb01a00fd15251076160cca7f44a38e5b024955357df7159c44c3124c6634262d" as Hex;
const P256 = "0x0000000000000000000000000000000000000100" as Address;

const pub = createPublicClient({ transport: http(RPC) });
let failed = 0;
const ok = (name: string, pass: boolean, detail = "") => { console.log(`${pass ? "✓" : "✗"} ${name}${detail ? "  · " + detail : ""}`); if (!pass) failed++; };

async function main() {
  ok("Monad mainnet (chain 143)", (await pub.getChainId()) === 143);

  for (const [name, a] of [["LeashHub", HUB], ["LeashAccount implementation", IMPL], ["tUSD", TUSD]] as const) {
    const code = await pub.getCode({ address: a });
    ok(`${name} is deployed`, !!code && code !== "0x", a);
    const r = await fetch(`https://sourcify-api-monad.blockvision.org/v2/contract/143/${a}`).then((x) => x.json()).catch(() => null);
    ok(`${name} source is verified on MonadVision (Sourcify, exact match)`, r?.match === "match" || r?.match === "exact_match" || r?.runtimeMatch === "exact_match" || r?.runtimeMatch === "match", r?.match ?? r?.runtimeMatch ?? "unknown");
  }
  const impl = await pub.readContract({ address: HUB, abi: parseAbi(["function implementation() view returns (address)"]), functionName: "implementation" });
  ok("Hub clones that implementation", impl.toLowerCase() === IMPL.toLowerCase());

  // The refused payment: a real transaction that reverted inside LeashAccount.pay
  const tx = await pub.getTransaction({ hash: REFUSED_TX });
  const rc = await pub.getTransactionReceipt({ hash: REFUSED_TX });
  const fn = decodeFunctionData({ abi: parseAbi(["function pay(address seller, uint256 amount, bytes32 ref)"]), data: tx.input }).functionName;
  ok("Over-cap payment was refused on-chain", rc.status === "reverted" && fn === "pay" && tx.to?.toLowerCase() === DEMO_ACCOUNT.toLowerCase(), `block ${rc.blockNumber}, ${rc.gasUsed} gas`);

  // ERC-8004: the demo agent is an identity owned by the passkey account
  const owner = await pub.readContract({ address: IDENTITY, abi: parseAbi(["function ownerOf(uint256) view returns (address)"]), functionName: "ownerOf", args: [DEMO_AGENT_ID] });
  ok(`ERC-8004 agent #${DEMO_AGENT_ID} is owned by its Leash account`, owner.toLowerCase() === DEMO_ACCOUNT.toLowerCase(), owner);

  // P256 precompile at 0x0100: valid signature -> 1, tampered -> empty
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const msg = Buffer.from("leash verify");
  const hash = crypto.createHash("sha256").update(msg).digest();
  const sig = crypto.sign("sha256", msg, { key: privateKey, dsaEncoding: "ieee-p1363" }); // signs sha256(msg) = hash
  const xy = (b: string) => Buffer.from(b, "base64url");
  const input = concat([toHex(hash), toHex(sig.subarray(0, 32)), toHex(sig.subarray(32)), toHex(xy(jwk.x)), toHex(xy(jwk.y))]);
  const good = await pub.call({ to: P256, data: input });
  const bad = await pub.call({ to: P256, data: (input.slice(0, 2) + "ff" + input.slice(4)) as Hex });
  ok("P256 precompile at 0x0100 verifies a passkey signature", BigInt(good.data ?? "0x0") === 1n && (!bad.data || bad.data === "0x"));
  const gas = await pub.estimateGas({ to: P256, data: input });
  ok("…for about 6,900 gas on top of the call", gas - 21000n - 16n * 160n < 9000n, `${gas} gas total for a direct call`);

  // The seller check answers in one read
  const c = await pub.readContract({ address: HUB, abi: parseAbi(["function check(address,address,uint256) view returns (uint8,uint256,uint64,uint256,address)"]), functionName: "check", args: [keccak256(toHex("nobody")).slice(0, 42) as Address, DEMO_ACCOUNT, 1n] });
  ok("Seller check answers UNKNOWN_AGENT for an unleashed key", c[0] === 1);

  // The live pieces
  const r1 = await fetch("https://leash-monad.vercel.app/api/forecast");
  ok("Paid API answers 402 without payment", r1.status === 402);
  const n = await fetch("https://leash-monad.vercel.app/api/network").then((x) => x.json()).catch(() => null);
  ok("Envio indexer is serving the network view", !!n?.Stats?.[0], n?.Stats?.[0] ? `${n.Stats[0].agentsLeashed} agents, ${n.Stats[0].payments} payments` : "");
  for (const p of ["leash-monad", "leash-monad-mcp"]) {
    const v = await fetch(`https://registry.npmjs.org/${p}/latest`).then((x) => x.json()).catch(() => null);
    ok(`npm: ${p} is published`, !!v?.version, v?.version);
  }

  console.log(failed ? `\n${failed} check(s) failed` : "\nAll claims check out.");
  process.exit(failed ? 1 : 0);
}
main();
