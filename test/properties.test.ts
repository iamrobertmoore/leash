// Property tests: long random runs against a simple model of the leash, plus every way a stolen agent key might
// try to get money out. Seeded, so a failure reproduces exactly.
import { expect } from "chai";
import hre from "hardhat";
import { toHex, type Address } from "viem";
import { setup, usd, DAY, Status } from "./helpers";
import { softPasskey } from "../lib/webauthn";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const advance = async (s: number) => { await hre.network.provider.send("evm_increaseTime", [s]); await hre.network.provider.send("evm_mine"); };
const STATUS_NAME = Object.fromEntries(Object.entries(Status).map(([k, v]) => [v, k]));

describe("Leash properties", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    it(`seed ${seed}: 150 random steps; the seller check always predicts the payment, and no payment takes a day over the cap in force`, async function () {
      this.timeout(120_000);
      const r = rng(seed);
      const { owner, account, hub, agentW, sellerW, otherSellerW, usdT, pc } = await setup();
      await usdT.write.mint([account.address, usd(100)]);
      await usdT.write.mint([account.address, usd(100)]);
      const agent = agentW.account.address;
      const sellers: Address[] = [sellerW.account.address, otherSellerW.account.address];
      const t0 = Number((await pc.getBlock()).timestamp);
      const expiry = BigInt(t0 + 60 * DAY);
      let cap = 5;
      await owner("leash", [agent, usdT.address, usd(cap), expiry, [sellers[0]], ""]);

      // the model
      const allowed = new Set<string>([sellers[0].toLowerCase()]);
      const spent = new Map<number, number>(); // UTC day -> cents
      let paid = 0, refused = 0;

      for (let step = 0; step < 150; step++) {
        const x = r();
        if (x < 0.1) { await advance(Math.floor(r() * 12 * 3600)); continue; }
        if (x < 0.17) { cap = 1 + Math.floor(r() * 9); await owner("setCap", [agent, usd(cap), expiry]); continue; }
        if (x < 0.22) {
          const s = sellers[1], on = !allowed.has(s.toLowerCase());
          await owner("setSeller", [agent, s, on]);
          on ? allowed.add(s.toLowerCase()) : allowed.delete(s.toLowerCase());
          continue;
        }
        const seller = sellers[r() < 0.75 ? 0 : 1];
        const cents = 1 + Math.floor(r() * 300);
        const amount = usd(cents / 100);
        const [status] = await hub.read.check([agent, seller, amount]);

        // what the model expects (the next block's day: pay lands in a new block, a second later at most)
        const day = Math.floor((Number((await pc.getBlock()).timestamp) + 1) / DAY);
        const used = spent.get(day) ?? 0;
        const want = !allowed.has(seller.toLowerCase()) ? Status.SELLER_NOT_ALLOWED : used + cents > cap * 100 ? Status.OVER_CAP : Status.OK;

        let ok = true;
        try { await account.write.pay([seller, amount, toHex(step, { size: 32 })], { account: agentW.account }); }
        catch { ok = false; }

        expect(ok, `step ${step}: check said ${STATUS_NAME[status]}`).to.equal(status === Status.OK);
        expect(STATUS_NAME[status], `step ${step}: model`).to.equal(STATUS_NAME[want]);
        if (ok) {
          // a payment only ever lands if the day's total stays within the cap in force at that moment
          expect(used + cents, `step ${step}`).to.be.at.most(cap * 100);
          spent.set(day, used + cents); paid++;
        } else refused++;
      }
      // both paths were exercised
      expect(paid).to.be.greaterThan(10);
      expect(refused).to.be.greaterThan(10);
      // and the money that left is exactly what the model says was paid
      const total = [...spent.values()].reduce((a, b) => a + b, 0);
      const out = (await usdT.read.balanceOf([sellers[0]])) + (await usdT.read.balanceOf([sellers[1]]));
      expect(out).to.equal(usd(total / 100));
    });
  }

  it("a stolen agent key has no way out but pay(): owner functions, forged passkeys and other accounts all refuse", async () => {
    const { owner, account, hub, agentW, sellerW, usdT, now } = await setup();
    const agent = agentW.account;
    await owner("leash", [agent.address, usdT.address, usd(5), BigInt(now + DAY), [sellerW.account.address], ""]);
    const as = { account: agent };

    // every owner function, called directly by the agent
    await expect(account.write.withdraw([usdT.address, agent.address, usd(1)], as)).to.be.rejectedWith("OnlySelf");
    await expect(account.write.setCap([agent.address, usd(1000), BigInt(now + 9 * DAY)], as)).to.be.rejectedWith("OnlySelf");
    await expect(account.write.setSeller([agent.address, agent.address, true], as)).to.be.rejectedWith("OnlySelf");
    await expect(account.write.leash([agent.address, usdT.address, usd(1000), BigInt(now + DAY), [], ""], as)).to.be.rejectedWith("OnlySelf");
    await expect(account.write.revoke([agent.address], as)).to.be.rejectedWith("OnlySelf");

    // an owner op signed by a passkey the attacker controls
    const evil = softPasskey();
    const { encodeFunctionData } = await import("viem");
    const op = encodeFunctionData({ abi: account.abi, functionName: "withdraw", args: [usdT.address, agent.address, usd(100)] });
    const auth = evil.sign(await account.read.opDigest([op, await account.read.nonce()]));
    await expect(account.write.ownerExecute([op, auth], as)).to.be.rejectedWith("BadSignature");

    // paying itself, or anyone not on the list
    await expect(account.write.pay([agent.address, usd(1), toHex(0, { size: 32 })], as)).to.be.rejectedWith("SellerNotAllowed");

    // another Leash account it isn't leashed to
    const other = await (async () => {
      const pk = softPasskey();
      await hub.write.createAccount([pk.x, pk.y]);
      return hre.viem.getContractAt("LeashAccount", await hub.read.predict([pk.x, pk.y]));
    })();
    await usdT.write.mint([other.address, usd(50)]);
    await expect(other.write.pay([sellerW.account.address, usd(1), toHex(0, { size: 32 })], as)).to.be.rejectedWith("UnknownAgent");

    // nothing moved
    expect(await usdT.read.balanceOf([account.address])).to.equal(usd(100));
    expect(await usdT.read.balanceOf([agent.address])).to.equal(0n);
  });

  it("the seller check never reverts, whatever it is asked", async () => {
    const { owner, hub, agentW, sellerW, usdT, now } = await setup();
    await owner("leash", [agentW.account.address, usdT.address, usd(5), BigInt(now + DAY), [], ""]);
    const r = rng(42);
    const addrs = [agentW.account.address, sellerW.account.address, "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000badf00d"] as Address[];
    const amounts = [0n, 1n, usd(5), usd(5) + 1n, 2n ** 255n, 2n ** 256n - 1n];
    for (let i = 0; i < 60; i++) {
      const a = addrs[Math.floor(r() * addrs.length)], s = addrs[Math.floor(r() * addrs.length)], m = amounts[Math.floor(r() * amounts.length)];
      const [status] = await hub.read.check([a, s, m]);
      expect(Object.values(Status)).to.include(status);
    }
  });
});
