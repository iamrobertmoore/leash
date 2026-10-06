import { route, isHex } from "./_util";
import { createAccount, prepareAgents } from "../server/relayer";
// POST {x, y} -> the passkey's Leash account (created and funded with demo dollars if new), plus the demo agents.
export default (req: any, res: any) => route(req, res, async ({ x, y }) => {
  if (!isHex(x, 32) || !isHex(y, 32)) throw new Error("x and y must be 32-byte hex");
  const account = await createAccount(x, y);
  const agents = await prepareAgents(account);
  return { account, ...agents };
}, { max: 10 });
