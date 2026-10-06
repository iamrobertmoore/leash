import { indexer } from "envio";


const ZERO = 0n;
const dayId = (ts: number) => `day-${Math.floor(ts / 86400)}`;

async function bump(context: any, ts: number, f: (s: any) => any) {
  for (const id of ["all", dayId(ts)]) {
    const s = (await context.Stats.get(id)) ?? { id, accounts: 0, agentsLeashed: 0, agentsRevoked: 0, payments: 0, totalPaid: ZERO, briefsSealed: 0 };
    context.Stats.set(f({ ...s }));
  }
}

// Every passkey account is a clone created by the hub: start indexing it as soon as it exists.
indexer.contractRegister({ contract: "LeashHub", event: "AccountCreated" }, async ({ event, context }) => {
  context.chain.LeashAccount.add(event.params.account);
});

indexer.onEvent({ contract: "LeashHub", event: "AccountCreated", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const ts = Number(event.block.timestamp);
  context.Account.set({
    id: event.params.account, passkeyX: event.params.x, passkeyY: event.params.y,
    createdAt: ts, createdBlock: BigInt(event.block.number), agentCount: 0, totalPaid: ZERO,
  });
  await bump(context, ts, (s) => ({ ...s, accounts: s.accounts + 1 }));
});

indexer.onEvent({ contract: "LeashHub", event: "AgentLinked" }, async () => { /* AgentLeashed carries everything we need */ });

indexer.onEvent({ contract: "LeashAccount", event: "AgentLeashed", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const ts = Number(event.block.timestamp);
  const p = event.params;
  context.Agent.set({
    id: p.agent, account_id: event.srcAddress, erc8004Id: p.agentId, token: p.token, dailyCap: p.dailyCap, expiry: p.expiry,
    anySeller: p.anySeller, revoked: false, revokedAt: undefined, totalPaid: ZERO, paymentCount: 0, hasBrief: false, briefSize: 0, leashedAt: ts,
  });
  const acct = await context.Account.get(event.srcAddress);
  if (acct) context.Account.set({ ...acct, agentCount: acct.agentCount + 1 });
  await bump(context, ts, (s) => ({ ...s, agentsLeashed: s.agentsLeashed + 1 }));
});

indexer.onEvent({ contract: "LeashAccount", event: "Paid", fields: { block: ["timestamp"], transaction: ["hash"] } }, async ({ event, context }) => {
  const ts = Number(event.block.timestamp);
  const p = event.params;
  context.Payment.set({
    id: `${event.transaction.hash}-${event.logIndex}`, agent_id: p.agent, seller_id: p.seller, amount: p.amount, ref: p.ref,
    remainingToday: p.remainingToday, block: BigInt(event.block.number), timestamp: ts, txHash: event.transaction.hash,
  });
  const agent = await context.Agent.get(p.agent);
  if (agent) context.Agent.set({ ...agent, totalPaid: agent.totalPaid + p.amount, paymentCount: agent.paymentCount + 1 });
  const acct = await context.Account.get(event.srcAddress);
  if (acct) context.Account.set({ ...acct, totalPaid: acct.totalPaid + p.amount });
  const pairId = `${p.seller}-${p.agent}`;
  const firstTime = !(await context.SellerAgent.get(pairId));
  if (firstTime) context.SellerAgent.set({ id: pairId });
  const seller = (await context.Seller.get(p.seller)) ?? { id: p.seller, totalReceived: ZERO, paymentCount: 0, agentsServed: 0 };
  context.Seller.set({ ...seller, totalReceived: seller.totalReceived + p.amount, paymentCount: seller.paymentCount + 1, agentsServed: seller.agentsServed + (firstTime ? 1 : 0) });
  await bump(context, ts, (s) => ({ ...s, payments: s.payments + 1, totalPaid: s.totalPaid + p.amount }));
});

indexer.onEvent({ contract: "LeashAccount", event: "Revoked", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const ts = Number(event.block.timestamp);
  const agent = await context.Agent.get(event.params.agent);
  if (agent) context.Agent.set({ ...agent, revoked: true, revokedAt: ts });
  await bump(context, ts, (s) => ({ ...s, agentsRevoked: s.agentsRevoked + 1 }));
});

indexer.onEvent({ contract: "LeashAccount", event: "CapChanged" }, async ({ event, context }) => {
  const agent = await context.Agent.get(event.params.agent);
  if (agent) context.Agent.set({ ...agent, dailyCap: event.params.dailyCap, expiry: event.params.expiry });
});

indexer.onEvent({ contract: "LeashAccount", event: "SellerSet" }, async ({ event, context }) => {
  const agent = await context.Agent.get(event.params.agent);
  if (agent && event.params.allowed) context.Agent.set({ ...agent, anySeller: false });
});

indexer.onEvent({ contract: "LeashAccount", event: "BriefSealed", fields: { block: ["timestamp"] } }, async ({ event, context }) => {
  const agent = await context.Agent.get(event.params.agent);
  if (agent) context.Agent.set({ ...agent, hasBrief: true, briefSize: Number(event.params.size) });
  await bump(context, Number(event.block.timestamp), (s) => ({ ...s, briefsSealed: s.briefsSealed + 1 }));
});
