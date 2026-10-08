// Mutation check: break each safety rule in the contracts, one at a time, and confirm the test suite fails.
// A mutant that survives means a rule no test is guarding. Writes docs/MUTATION.md.
//   npx tsx scripts/mutate.ts        (about 6 minutes)
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const A = "contracts/LeashAccount.sol", H = "contracts/LeashHub.sol";
const M: [string, string, string, string][] = [
  // [file, what the mutant breaks, original, mutant]
  [A, "pay() skips the leash check entirely", "if (s != Status.OK) _revertFor(s, l, seller, remaining, amount);", ""],
  [A, "revoked agents can still pay", "if (!l.active) return (Status.REVOKED, 0);", ""],
  [A, "revoke does nothing", "l.active = false;", ""],
  [A, "the expiry second still pays (off by one)", "if (block.timestamp >= l.expiry)", "if (block.timestamp > l.expiry)"],
  [A, "the seller allow-list is ignored", "if (!l.anySeller && !sellerAllowed[agent][seller]) return (Status.SELLER_NOT_ALLOWED, remaining);", ""],
  [A, "adding a seller leaves an any-seller leash open", "if (allowed) l.anySeller = false;", ""],
  [A, "one unit over the cap still pays (off by one)", "if (amount > remaining) return (Status.OVER_CAP, remaining);", "if (amount > remaining + 1) return (Status.OVER_CAP, remaining);"],
  [A, "spending is never counted", "l.spentToday += uint128(amount);", ""],
  [A, "yesterday's spending is never cleared", "l.spentToday = 0;", ""],
  [A, "a new day still uses yesterday's spending", "uint256 spent = l.day == _today() ? l.spentToday : 0;", "uint256 spent = l.spentToday;"],
  [A, "a signature can be replayed (nonce never moves)", "nonce = n + 1;", ""],
  [A, "Face ID / Touch ID / PIN not required", "WebAuthn.verify(abi.encodePacked(digest), true,", "WebAuthn.verify(abi.encodePacked(digest), false,"],
  [A, "a signature works on any account with the same passkey", "keccak256(abi.encode(block.chainid, address(this), n, keccak256(op)))", "keccak256(abi.encode(block.chainid, n, keccak256(op)))"],
  [A, "a failed owner action still uses up the signature", "if (!ok) {", "if (false) {"],
  [A, "owner functions callable by anyone", "if (msg.sender != address(this)) revert OnlySelf();", ""],
  [A, "an account can be re-initialised (owner takeover)", "if (hub != address(0)) revert AlreadyInitialized();", ""],
  [A, "an agent can be leashed twice (revoke undone)", "if (leashes[agent].token != address(0)) revert AgentExists();", ""],
  [A, "a zero cap or past expiry is accepted", "if (agent == address(0) || token == address(0) || dailyCap == 0 || expiry <= block.timestamp) {", "if (agent == address(0) || token == address(0)) {"],
  [A, "setCap accepts a zero cap or past expiry", "if (dailyCap == 0 || expiry <= block.timestamp) revert InvalidLeash();", ""],
  [A, "the sealed brief has no size limit", "if (sealedBrief.length > 1024) revert BriefTooLarge();", ""],
  [H, "another account can take over an agent key", "if (current != address(0) && current != msg.sender) revert AgentTaken();", ""],
  [H, "anyone can link an agent to anything", "if (!isAccount[msg.sender]) revert NotAccount();", ""],
  [H, "the hub's check says OK for unknown agents", "if (account == address(0)) return (LeashAccount.Status.UNKNOWN_AGENT, 0, 0, 0, address(0));", "if (account == address(0)) return (LeashAccount.Status.OK, 0, 0, 0, address(0));"],
];

const run = () => spawnSync("npx", ["hardhat", "test", "test/leash.test.ts", "test/rules.test.ts", "test/properties.test.ts"], { encoding: "utf8" });
const base = run();
if (base.status !== 0) { console.error("suite fails before mutation; fix that first"); process.exit(1); }

const rows: string[] = [];
let killed = 0;
for (const [file, what, from, to] of M) {
  const src = fs.readFileSync(file, "utf8");
  if (src.split(from).length !== 2) throw new Error(`mutation site not unique or missing in ${file}: ${from}`);
  fs.writeFileSync(file, src.replace(from, to));
  try {
    const r = run();
    const compiled = !/Compilation failed|HH600/.test(r.stdout + r.stderr);
    const failing = (r.stdout.match(/(\d+) failing/) ?? [])[1];
    const dead = r.status !== 0 && compiled;
    if (dead) killed++;
    rows.push(`| ${what} | ${dead ? `caught (${failing ?? "?"} failing)` : compiled ? "**survived**" : "did not compile"} |`);
    console.log(`${dead ? "✓ caught  " : "✗ SURVIVED"}  ${what}${failing ? ` (${failing} failing)` : ""}`);
  } finally {
    fs.writeFileSync(file, src);
  }
}
const md = `# Mutation check

Each row breaks one safety rule in the contracts, then runs the test suite. "Caught" means at least one test failed,
so that rule is guarded. Re-run with \`npx tsx scripts/mutate.ts\`.

**${killed} of ${M.length} mutants caught.** Last run ${new Date().toISOString().slice(0, 10)}.

| The contract is changed so that… | Result |
|---|---|
${rows.join("\n")}
`;
fs.writeFileSync("docs/MUTATION.md", md);
console.log(`\n${killed}/${M.length} caught; wrote docs/MUTATION.md`);
process.exit(killed === M.length ? 0 : 1);
