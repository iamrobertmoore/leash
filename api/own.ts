import { route, isHex } from "./_util";
import { fundOwnAgent } from "../server/relayer";
// POST {account, agent} -> after the owner's passkey has leashed their own agent (e.g. an MCP agent), top it up with gas.
export default (req: any, res: any) => route(req, res, async ({ account, agent }) => {
  if (!isHex(account, 20) || !isHex(agent, 20)) throw new Error("account and agent must be addresses");
  return fundOwnAgent(account, agent);
}, { max: 6 });
