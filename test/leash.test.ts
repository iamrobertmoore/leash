import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, keccak256, toHex, getAddress, type Hex } from "viem";
import { setup, usd, DAY, Status } from "./helpers";
import { softPasskey } from "../lib/webauthn";

describe("Leash", () => {
  it("creates the same account for the same passkey, and only once", async () => {
    const { hub, pk, account } = await setup();
    expect(await hub.read.predict([pk.x, pk.y])).to.equal(getAddress(account.address));
    await hub.write.createAccount([pk.x, pk.y]); // idempotent
    expect(await account.read.ownerX()).to.equal(pk.x);
  });

  it("leashes an agent with the passkey and registers it under ERC-8004, owned by the account", async () => {
    const { owner, account, agentW, sellerW, usdT, identity, hub, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [sellerW.account.address], "ipfs://agent"]);
    const l = await account.read.leashes([agentW.account.address]);
    expect(l[1]).to.equal(usd(5));
    const agentId = l[5];
    expect(await identity.read.ownerOf([agentId])).to.equal(getAddress(account.address));
    expect(await hub.read.accountOf([agentW.account.address])).to.equal(getAddress(account.address));
  });

  it("lets the agent spend inside its cap, then refuses on-chain at the cap", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [sellerW.account.address], ""]);
    const ref = keccak256(toHex("call-1"));
    await account.write.pay([sellerW.account.address, usd(2), ref], { account: agentW.account });
    await account.write.pay([sellerW.account.address, usd(2), ref], { account: agentW.account });
    expect(await usdT.read.balanceOf([sellerW.account.address])).to.equal(usd(4));

    const c = await hub.read.check([agentW.account.address, sellerW.account.address, usd(2)]);
    expect(c[0]).to.equal(Status.OVER_CAP);
    expect(c[1]).to.equal(usd(1));
    await expect(
      account.write.pay([sellerW.account.address, usd(2), ref], { account: agentW.account }),
    ).to.be.rejectedWith("OverCap");
    expect(await usdT.read.balanceOf([sellerW.account.address])).to.equal(usd(4));
  });

  it("refuses sellers that are not on the allow-list", async () => {
    const { owner, account, agentW, sellerW, otherSellerW, usdT, hub, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [sellerW.account.address], ""]);
    expect((await hub.read.check([agentW.account.address, otherSellerW.account.address, usd(1)]))[0]).to.equal(Status.SELLER_NOT_ALLOWED);
    await expect(
      account.write.pay([otherSellerW.account.address, usd(1), toHex(0, { size: 32 })], { account: agentW.account }),
    ).to.be.rejectedWith("SellerNotAllowed");
  });

  it("revokes in one owner action, and the seller sees it", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, usd(1)]))[0]).to.equal(Status.OK);
    await owner("revoke", [agentW.account.address]);
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, usd(1)]))[0]).to.equal(Status.REVOKED);
    await expect(
      account.write.pay([sellerW.account.address, usd(1), toHex(0, { size: 32 })], { account: agentW.account }),
    ).to.be.rejectedWith("AgentRevoked");
  });

  it("expires, and resets the daily budget at the next UTC day", async () => {
    const { owner, account, agentW, sellerW, usdT, hub, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + 3 * DAY), [], ""]);
    await account.write.pay([sellerW.account.address, usd(5), toHex(0, { size: 32 })], { account: agentW.account });
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, usd(1)]))[0]).to.equal(Status.OVER_CAP);
    await hre.network.provider.send("evm_increaseTime", [DAY]);
    await hre.network.provider.send("evm_mine");
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, usd(5)]))[0]).to.equal(Status.OK);
    await hre.network.provider.send("evm_increaseTime", [3 * DAY]);
    await hre.network.provider.send("evm_mine");
    expect((await hub.read.check([agentW.account.address, sellerW.account.address, usd(1)]))[0]).to.equal(Status.EXPIRED);
  });

  it("rejects a wrong passkey, a replayed signature, and direct calls to owner functions", async () => {
    const { account, agentW, usdT, relayer, now, pk } = await setup();
    const op = encodeFunctionData({
      abi: account.abi,
      functionName: "leash",
      args: [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""],
    });
    const intruder = softPasskey();
    const bad = intruder.sign(await account.read.opDigest([op, 0n]));
    await expect(account.write.ownerExecute([op, bad], { account: relayer.account })).to.be.rejectedWith("BadSignature");
    await expect(account.write.revoke([agentW.account.address], { account: relayer.account })).to.be.rejectedWith("OnlySelf");
    const good = pk.sign(await account.read.opDigest([op, 0n]));
    await account.write.ownerExecute([op, good], { account: relayer.account });
    await expect(account.write.ownerExecute([op, good], { account: relayer.account })).to.be.rejectedWith("BadSignature");
  });

  it("seals a brief onto the agent's ERC-8004 identity, owner only", async () => {
    const { owner, account, agentW, usdT, identity, now, relayer } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    const sealed = "0x01aabbccddeeff00112233445566778899";
    await owner("setBrief", [agentW.account.address, sealed]);
    const id = (await account.read.leashes([agentW.account.address]))[5];
    expect(await identity.read.getMetadata([id, "leash.brief"])).to.equal(sealed);
    await expect(account.write.setBrief([agentW.account.address, sealed], { account: relayer.account })).to.be.rejectedWith("OnlySelf");
  });

  it("an unknown agent comes back UNKNOWN_AGENT", async () => {
    const { hub, rawAgentW, sellerW } = await setup();
    const c = await hub.read.check([rawAgentW.account.address, sellerW.account.address, usd(1)]);
    expect(c[0]).to.equal(Status.UNKNOWN_AGENT);
  });

  it("drain script: 20 hijacked attempts lose the whole wallet unleashed, at most the cap leashed", async () => {
    const { owner, account, agentW, sellerW, rawAgentW, usdT, now } = await setup();
    const attacker = sellerW.account.address; // the hijacked agent's 'seller' is the attacker
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    await usdT.write.mint([rawAgentW.account.address, usd(100)]);
    let unleashedLost = 0n, leashedLost = 0n, refused = 0;
    for (let i = 0; i < 20; i++) {
      await usdT.write.transfer([attacker, usd(5)], { account: rawAgentW.account }); unleashedLost += usd(5);
      try { await account.write.pay([attacker, usd(5), toHex(i, { size: 32 })], { account: agentW.account }); leashedLost += usd(5); }
      catch { refused++; }
    }
    expect(unleashedLost).to.equal(usd(100));
    expect(leashedLost).to.equal(usd(5));
    expect(refused).to.equal(19);
  });
});
