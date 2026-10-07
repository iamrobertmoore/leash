// Shared fixture: a fresh hub, identity registry, test dollar and one passkey-owned account.
import hre from "hardhat";
import { encodeFunctionData, parseUnits } from "viem";
import { softPasskey } from "../lib/webauthn";

export const usd = (n: number) => parseUnits(String(n), 6);
export const DAY = 24 * 60 * 60;
export const Status = { OK: 0, UNKNOWN_AGENT: 1, REVOKED: 2, EXPIRED: 3, SELLER_NOT_ALLOWED: 4, OVER_CAP: 5 };

export async function setup() {
  const [relayer, agentW, sellerW, otherSellerW, rawAgentW] = await hre.viem.getWalletClients();
  const pc = await hre.viem.getPublicClient();
  const identity = await hre.viem.deployContract("MockIdentityRegistry");
  const hub = await hre.viem.deployContract("LeashHub", [identity.address]);
  const usdT = await hre.viem.deployContract("TestUSD");
  const pk = softPasskey();
  await hub.write.createAccount([pk.x, pk.y]);
  const accountAddr = await hub.read.predict([pk.x, pk.y]);
  const account = await hre.viem.getContractAt("LeashAccount", accountAddr);
  await usdT.write.mint([accountAddr, usd(100)]);

  // Owner action: sign the op with the passkey, any relayer submits it.
  async function owner(fn: string, args: unknown[]) {
    const op = encodeFunctionData({ abi: account.abi, functionName: fn as any, args: args as any });
    const n = await account.read.nonce();
    const digest = await account.read.opDigest([op, n]);
    const auth = pk.sign(digest);
    return account.write.ownerExecute([op, auth], { account: relayer.account });
  }
  const now = Number((await pc.getBlock()).timestamp);
  return { relayer, agentW, sellerW, otherSellerW, rawAgentW, pc, identity, hub, usdT, pk, account, owner, now };
}
