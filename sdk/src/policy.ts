/**
 * Seller policy: pay only sellers that have money at stake on their own record.
 *
 * A leash caps how much an agent spends. It says nothing about who the agent pays beyond an address
 * allow-list. A seller policy adds an allow-list by stake: before paying, the agent checks that the
 * seller's ERC-8004 identity has a live bond on Sclera, an immutable contract on Monad where an agent's
 * owner locks USDC against a floor on its own claim-truth rate. A slashed bond is burned, so nobody in
 * the decision path is paid by a slash.
 *
 * Opt-in and off by default: nothing here runs unless the caller passes `sellerPolicy`.
 *
 * What is checked, all from the chain, nothing from the seller's word:
 *   1. The seller names its ERC-8004 id (`sellerAgentId` in the 402 body, from GateConfig.agentId).
 *   2. That id's owner or agent wallet, read from the Identity Registry, is the address being paid.
 *      Without this a seller could name somebody else's bonded agent.
 *   3. Sclera reports a bond for that id in state Active whose window has not ended. A matured bond
 *      can be released at any moment, so it is not counted as stake.
 *   4. Optionally: at least `minBondUsd` of USDC and a floor of at least `minFloorBps`.
 *
 * Self-contained on purpose (viem only), so it can be read and tested on its own.
 */
import { createPublicClient, http, parseUnits, type Address, type PublicClient } from "viem";

/** Sclera on Monad mainnet. v2 takes every new bond. v1 still holds older bonds and is read second. */
export const SCLERA = {
  v2: "0xB4d641f016f53C683c409F271eE85e136041FE3f",
  v1: "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf",
} as const satisfies Record<string, Address>;

const IDENTITY_REGISTRY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const USDC: Address = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const ZERO = "0x0000000000000000000000000000000000000000";

export const scleraAbi = [
  { type: "function", name: "bonds", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [
    { name: "agent", type: "address" }, { name: "postedAt", type: "uint64" }, { name: "state", type: "uint8" },
    { name: "token", type: "address" }, { name: "windowBlocks", type: "uint64" }, { name: "amount", type: "uint128" },
    { name: "minTruthRateBps", type: "uint16" }, { name: "minSampleSize", type: "uint32" }, { name: "lastNonce", type: "uint64" }] }] },
] as const;

const identityAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getAgentWallet", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

export type SellerPolicy = {
  /** Refuse to pay a seller that has no live Sclera bond. The only rule today. */
  requireBond: true;
  /** Smallest bond accepted, in USDC dollars. A bond in another token never meets this. Default: any amount. */
  minBondUsd?: string;
  /** Lowest claim-truth floor accepted, in basis points (8000 = 80%). Default: any floor. */
  minFloorBps?: number;
  /** Sclera deployments to read, in order. Default: v2 then v1, mainnet. */
  sclera?: Address[];
  identityRegistry?: Address;
  rpc?: string;
  client?: PublicClient;
};

export type SellerBond = { contract: Address; state: "active"; amount: string; token: Address; floorBps: number; endsAtBlock: string };
export type SellerVerdict =
  | { ok: true; agentId: string; bond: SellerBond }
  | { ok: false; reason: "no_agent_id" | "not_the_payee" | "no_bond" | "bond_matured" | "bond_too_small" | "floor_too_low" | "unreadable"; detail: string };

const STATE = ["none", "active", "slashed", "released"] as const;

/** Would this seller pass the policy? Every input except the policy comes from the chain. */
export async function checkSeller(payTo: Address, sellerAgentId: string | bigint | undefined, policy: SellerPolicy): Promise<SellerVerdict> {
  if (sellerAgentId === undefined || sellerAgentId === null || !/^\d+$/.test(String(sellerAgentId)) || BigInt(sellerAgentId) === 0n) {
    return { ok: false, reason: "no_agent_id", detail: "The seller didn't name an ERC-8004 agent id, so there's no bond to check." };
  }
  const id = BigInt(sellerAgentId);
  const c = policy.client ?? (createPublicClient({ transport: http(policy.rpc ?? "https://rpc.monad.xyz") }) as PublicClient);
  const registry = policy.identityRegistry ?? IDENTITY_REGISTRY;
  try {
    const [owner, wallet] = await Promise.all([
      c.readContract({ address: registry, abi: identityAbi, functionName: "ownerOf", args: [id] }),
      c.readContract({ address: registry, abi: identityAbi, functionName: "getAgentWallet", args: [id] }).catch(() => ZERO as Address),
    ]);
    const pay = payTo.toLowerCase();
    if (owner.toLowerCase() !== pay && wallet.toLowerCase() !== pay) {
      return { ok: false, reason: "not_the_payee", detail: `Agent ${id} belongs to ${owner}, not to ${payTo}, so its bond says nothing about this seller.` };
    }
    const head = await c.getBlockNumber();
    let matured: string | null = null;
    for (const contract of policy.sclera ?? [SCLERA.v2, SCLERA.v1]) {
      const b = await c.readContract({ address: contract, abi: scleraAbi, functionName: "bonds", args: [id] });
      if (STATE[b.state] !== "active") continue;
      const ends = b.postedAt + b.windowBlocks;
      if (head >= ends) { matured = `Agent ${id}'s bond on ${contract} ended at block ${ends} and can be withdrawn at any time.`; continue; }
      if (policy.minBondUsd !== undefined && (b.token.toLowerCase() !== USDC.toLowerCase() || b.amount < parseUnits(policy.minBondUsd, 6))) {
        return { ok: false, reason: "bond_too_small", detail: `Agent ${id}'s bond is ${b.amount} units of ${b.token}, below ${policy.minBondUsd} USDC.` };
      }
      if (policy.minFloorBps !== undefined && b.minTruthRateBps < policy.minFloorBps) {
        return { ok: false, reason: "floor_too_low", detail: `Agent ${id}'s floor is ${b.minTruthRateBps} bps, below ${policy.minFloorBps}.` };
      }
      return { ok: true, agentId: id.toString(), bond: { contract, state: "active", amount: b.amount.toString(), token: b.token, floorBps: b.minTruthRateBps, endsAtBlock: ends.toString() } };
    }
    return matured
      ? { ok: false, reason: "bond_matured", detail: matured }
      : { ok: false, reason: "no_bond", detail: `Agent ${id} has no live bond on Sclera.` };
  } catch (e) {
    // An unreadable chain refuses rather than pays: the policy exists to say no when it can't confirm stake.
    return { ok: false, reason: "unreadable", detail: `Couldn't read the seller's identity or bond: ${(e as Error).message.split("\n")[0]}` };
  }
}
