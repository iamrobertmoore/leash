// Every rule at its exact edge, and every way an owner signature could be misused.
import { expect } from "chai";
import hre from "hardhat";
import crypto from "node:crypto";
import { encodeFunctionData, getAddress, parseEventLogs, toHex, type Address } from "viem";
import { setup, usd, DAY, Status } from "./helpers";
import { softPasskey } from "../lib/webauthn";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const REF = toHex(0, { size: 32 });
const at = async (t: number) => { await hre.network.provider.send("evm_setNextBlockTimestamp", [t]); await hre.network.provider.send("evm_mine"); };
const nextAt = (t: number) => hre.network.provider.send("evm_setNextBlockTimestamp", [t]);

describe("Leash rules at their edges", () => {
  it("cap: exactly the remaining budget pays; one micro-dollar more is refused with both numbers", async () => {
    const { owner, account, agentW, sellerW, usdT, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY * 3), [], ""]);
    const as = { account: agentW.account };
    await account.write.pay([sellerW.account.address, usd(3), REF], as);
    await expect(account.write.pay([sellerW.account.address, usd(2) + 1n, REF], as)).to.be.rejectedWith(`OverCap(${usd(2)}, ${usd(2) + 1n})`);
    await account.write.pay([sellerW.account.address, usd(2), REF], as);
    expect(await usdT.read.balanceOf([sellerW.account.address])).to.equal(usd(5));
    await expect(account.write.pay([sellerW.account.address, 1n, REF], as)).to.be.rejectedWith("OverCap(0, 1)");
  });

  it("day: the budget comes back at exactly 00:00:00 UTC, not a second before", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, now } = await setup();
    const midnight = (Math.floor(now / DAY) + 2) * DAY;
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(midnight + DAY), [], ""]);
    await at(midnight - 10);
    await account.write.pay([sellerW.account.address, usd(5), REF], { account: agentW.account });
    await at(midnight - 1);
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, 1n]))[0]).to.equal(Status.OVER_CAP);
    await nextAt(midnight);
    await account.write.pay([sellerW.account.address, usd(5), REF], { account: agentW.account });
    expect(await usdT.read.balanceOf([sellerW.account.address])).to.equal(usd(10));
  });

  it("expiry: pays at expiry − 1 second, refused at the expiry second itself", async () => {
    const { owner, account, agentW, sellerW, usdT, now } = await setup();
    const exp = now + 1000;
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(exp), [], ""]);
    await nextAt(exp - 1);
    await account.write.pay([sellerW.account.address, usd(1), REF], { account: agentW.account });
    await nextAt(exp);
    await expect(account.write.pay([sellerW.account.address, usd(1), REF], { account: agentW.account })).to.be.rejectedWith(`LeashExpired(${exp})`);
  });

  it("lowering the cap mid-day below what was spent stops the agent at once; raising it gives back only the difference", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, now } = await setup();
    const exp = BigInt(now + 3 * DAY);
    await owner("leash", [agentW.account.address, usdT.address, usd(5), exp, [], ""]);
    await account.write.pay([sellerW.account.address, usd(4), REF], { account: agentW.account });
    await owner("setCap", [agentW.account.address, usd(2), exp]);
    const c = await hub.read.check([agentW.account.address, sellerW.account.address, 1n]);
    expect([c[0], c[1]]).to.deep.equal([Status.OVER_CAP, 0n]);
    await owner("setCap", [agentW.account.address, usd(6), exp]);
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, usd(2)]))[1]).to.equal(usd(2));
  });

  it("revoke is final: a later cap change does not bring the agent back, and its key can never be leashed again", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, now } = await setup();
    const exp = BigInt(now + 3 * DAY);
    await owner("leash", [agentW.account.address, usdT.address, usd(5), exp, [], ""]);
    await owner("revoke", [agentW.account.address]);
    await owner("setCap", [agentW.account.address, usd(50), exp]);
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, 1n]))[0]).to.equal(Status.REVOKED);
    await expect(owner("leash", [agentW.account.address, usdT.address, usd(5), exp, [], ""])).to.be.rejectedWith("AgentExists");
    await expect(account.write.pay([sellerW.account.address, 1n, REF], { account: agentW.account })).to.be.rejectedWith("AgentRevoked");
  });

  it("allow-list: adding a seller to an any-seller leash narrows it to that seller; removing a seller blocks it", async () => {
    const { owner, account, agentW, sellerW, otherSellerW, usdT, hub, now } = await setup();
    const [a, s1, s2] = [agentW.account.address, sellerW.account.address, otherSellerW.account.address];
    await owner("leash", [a, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    expect((await hub.read.check([a, s2, 1n]))[0]).to.equal(Status.OK);
    await owner("setSeller", [a, s1, true]);
    expect((await hub.read.check([a, s2, 1n]))[0]).to.equal(Status.SELLER_NOT_ALLOWED);
    expect((await hub.read.check([a, s1, 1n]))[0]).to.equal(Status.OK);
    await owner("setSeller", [a, s1, false]);
    await expect(account.write.pay([s1, 1n, REF], { account: agentW.account })).to.be.rejectedWith("SellerNotAllowed");
  });

  it("refuses leashes that could not be enforced: no agent, no token, a zero cap, an expiry in the past", async () => {
    const { owner, agentW, usdT, now } = await setup();
    const a = agentW.account.address, t = usdT.address, e = BigInt(now + DAY);
    for (const args of [[ZERO, t, usd(5), e], [a, ZERO, usd(5), e], [a, t, 0n, e], [a, t, usd(5), BigInt(now - 1)]] as const) {
      await expect(owner("leash", [...args, [], ""])).to.be.rejectedWith("InvalidLeash");
    }
    await owner("leash", [a, t, usd(5), e, [], ""]);
    await expect(owner("setCap", [a, 0n, e])).to.be.rejectedWith("InvalidLeash");
    await expect(owner("setCap", [ZERO, usd(1), e])).to.be.rejectedWith("UnknownAgent");
  });

  it("one agent key belongs to one account: a second account cannot claim it", async () => {
    const { owner, hub, agentW, usdT, relayer, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    const pk2 = softPasskey();
    await hub.write.createAccount([pk2.x, pk2.y]);
    const acc2 = await hre.viem.getContractAt("LeashAccount", await hub.read.predict([pk2.x, pk2.y]));
    const op = encodeFunctionData({ abi: acc2.abi, functionName: "leash", args: [agentW.account.address, usdT.address, usd(500), BigInt(now + DAY), [], ""] });
    const auth = pk2.sign(await acc2.read.opDigest([op, 0n]));
    await expect(acc2.write.ownerExecute([op, auth], { account: relayer.account })).to.be.rejectedWith("AgentTaken");
  });

  it("only a Leash account can link agents in the hub", async () => {
    const { hub, rawAgentW } = await setup();
    await expect(hub.write.link([rawAgentW.account.address], { account: rawAgentW.account })).to.be.rejectedWith("NotAccount");
  });

  it("a signature is bound to its action: it cannot authorise a different op", async () => {
    const { account, agentW, usdT, relayer, pk, now } = await setup();
    const op = encodeFunctionData({ abi: account.abi, functionName: "leash", args: [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""] });
    const swapped = encodeFunctionData({ abi: account.abi, functionName: "withdraw", args: [usdT.address, agentW.account.address, usd(100)] });
    const auth = pk.sign(await account.read.opDigest([op, 0n]));
    await expect(account.write.ownerExecute([swapped, auth], { account: relayer.account })).to.be.rejectedWith("BadSignature");
  });

  it("a signature is bound to its account: the same passkey's signature for one account fails on its account at another hub", async () => {
    const { identity, account, pk, usdT, relayer, agentW } = await setup();
    const hub2 = await hre.viem.deployContract("LeashHub", [identity.address]);
    await hub2.write.createAccount([pk.x, pk.y]);
    const twin = await hre.viem.getContractAt("LeashAccount", await hub2.read.predict([pk.x, pk.y]));
    expect(getAddress(twin.address)).to.not.equal(getAddress(account.address));
    const op = encodeFunctionData({ abi: account.abi, functionName: "withdraw", args: [usdT.address, agentW.account.address, 1n] });
    const auth = pk.sign(await account.read.opDigest([op, 0n]));
    await expect(twin.write.ownerExecute([op, auth], { account: relayer.account })).to.be.rejectedWith("BadSignature");
    await account.write.ownerExecute([op, auth], { account: relayer.account });
  });

  it("an older signed action dies once a newer one runs (nonce order)", async () => {
    const { account, agentW, usdT, relayer, pk, now, owner } = await setup();
    const op = encodeFunctionData({ abi: account.abi, functionName: "withdraw", args: [usdT.address, agentW.account.address, usd(1)] });
    const stale = pk.sign(await account.read.opDigest([op, 0n]));
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    await expect(account.write.ownerExecute([op, stale], { account: relayer.account })).to.be.rejectedWith("BadSignature");
  });

  it("requires user verification: a passkey assertion without Face ID / Touch ID / PIN is refused", async () => {
    const { hub, usdT, relayer, agentW } = await setup();
    const pem = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }) as string;
    const withUV = softPasskey({ privateKeyPem: pem });
    const noUV = softPasskey({ privateKeyPem: pem, flags: 0x01 });
    await hub.write.createAccount([withUV.x, withUV.y]);
    const acc = await hre.viem.getContractAt("LeashAccount", await hub.read.predict([withUV.x, withUV.y]));
    const op = encodeFunctionData({ abi: acc.abi, functionName: "withdraw", args: [usdT.address, agentW.account.address, 0n] });
    const digest = await acc.read.opDigest([op, 0n]);
    await expect(acc.write.ownerExecute([op, noUV.sign(digest)], { account: relayer.account })).to.be.rejectedWith("BadSignature");
    await acc.write.ownerExecute([op, withUV.sign(digest)], { account: relayer.account });
  });

  it("a failing owner action reverts whole: nothing changes and the nonce is not used up", async () => {
    const { owner, account, agentW, usdT, now } = await setup();
    await expect(owner("leash", [agentW.account.address, usdT.address, 0n, BigInt(now + DAY), [], ""])).to.be.rejectedWith("InvalidLeash");
    expect(await account.read.nonce()).to.equal(0n);
    expect(await account.read.agents()).to.deep.equal([]);
  });

  it("accounts cannot be re-initialised, and taking over the bare implementation gives no power over any account", async () => {
    const { account, hub, rawAgentW, usdT } = await setup();
    const evil = softPasskey();
    await expect(account.write.initialize([evil.x, evil.y, rawAgentW.account.address, rawAgentW.account.address], { account: rawAgentW.account })).to.be.rejectedWith("AlreadyInitialized");
    const impl = await hre.viem.getContractAt("LeashAccount", await hub.read.implementation());
    await impl.write.initialize([evil.x, evil.y, rawAgentW.account.address, rawAgentW.account.address], { account: rawAgentW.account });
    expect(await account.read.ownerX()).to.not.equal(evil.x);
    expect(await usdT.read.balanceOf([account.address])).to.equal(usd(100));
  });

  it("only the owner's passkey moves money out: withdraw pays exactly what was signed, to whom it was signed", async () => {
    const { owner, account, usdT, rawAgentW } = await setup();
    await owner("withdraw", [usdT.address, rawAgentW.account.address, usd(30)]);
    expect(await usdT.read.balanceOf([rawAgentW.account.address])).to.equal(usd(30));
    expect(await usdT.read.balanceOf([account.address])).to.equal(usd(70));
  });

  it("a payment the account cannot fund reverts whole: the day's budget is not consumed", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, rawAgentW, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(50), BigInt(now + DAY), [], ""]);
    await owner("withdraw", [usdT.address, rawAgentW.account.address, usd(99)]);
    await expect(account.write.pay([sellerW.account.address, usd(2), REF], { account: agentW.account })).to.be.rejected;
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, 1n]))[1]).to.equal(usd(50));
  });

  it("each payment emits who paid whom, how much, the caller's reference and what is left today", async () => {
    const { owner, account, agentW, sellerW, usdT, pc, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    const ref = toHex("order-42", { size: 32 });
    const h = await account.write.pay([sellerW.account.address, usd(2), ref], { account: agentW.account });
    const [ev] = parseEventLogs({ abi: account.abi, logs: (await pc.getTransactionReceipt({ hash: h })).logs, eventName: "Paid" }) as any[];
    expect(getAddress(ev.args.agent)).to.equal(getAddress(agentW.account.address));
    expect(getAddress(ev.args.seller)).to.equal(getAddress(sellerW.account.address));
    expect([ev.args.amount, ev.args.ref]).to.deep.equal([usd(2), ref]);
    expect(Object.values(ev.args)).to.include(usd(3));
  });

  it("the hub answers with the agent's account and ERC-8004 id, and keeps answering after a revoke", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    const id = (await account.read.leashes([agentW.account.address]))[5];
    await owner("revoke", [agentW.account.address]);
    const c = await hub.read.check([agentW.account.address, sellerW.account.address, 1n]);
    expect([c[0], c[3], getAddress(c[4])]).to.deep.equal([Status.REVOKED, id, getAddress(account.address)]);
  });

  it("a sealed brief is capped at 1 KB, so an owner can't be made to pay for a bloated identity", async () => {
    const { owner, agentW, usdT, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    await owner("setBrief", [agentW.account.address, toHex(new Uint8Array(1024))]);
    await expect(owner("setBrief", [agentW.account.address, toHex(new Uint8Array(1025))])).to.be.rejectedWith("BriefTooLarge");
  });
});
