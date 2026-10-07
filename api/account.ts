import { route, isHex } from "./_util";
import { createAccount, prepareAgents } from "../server/relayer";
// POST {x, y, own?} -> the passkey's Leash account (created and funded with demo dollars if new), plus the demo agents
// (skipped with own: true, when the owner is leashing an agent of their own).
export default (req: any, res: any) => route(req, res, async ({ x, y, own }) => {
  if (!isHex(x, 32) || !isHex(y, 32)) throw new Error("x and y must be 32-byte hex");
  const account = await createAccount(x, y);
  if (own) return { account };
  const agents = await prepareAgents(account);
  return { account, ...agents };
}, { max: 10 });
