import { route, isHex } from "./_util";
import { buyOnce } from "../server/seller";
// POST {account} -> the judge's agent buys one forecast through the Leash gate, every stage reported.
export default (req: any, res: any) => route(req, res, async ({ account }) => {
  if (!isHex(account, 20)) throw new Error("bad account");
  const proto = String(req.headers["x-forwarded-proto"] ?? "http"), host = String(req.headers["x-forwarded-host"] ?? req.headers.host);
  return buyOnce(account, `${proto}://${host}`);
}, { max: 20 });
