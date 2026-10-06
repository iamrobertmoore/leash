import { route, isHex } from "./_util";
import { attack } from "../server/relayer";
// POST {account} -> runs the 20-attempt drain script against the leashed agent and its unleashed twin.
export default (req: any, res: any) => route(req, res, async ({ account }) => {
  if (!isHex(account, 20)) throw new Error("bad account");
  return attack(account);
}, { max: 6 });
