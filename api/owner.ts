import { route, isHex } from "./_util";
import { submitOwner } from "../server/relayer";
// POST {account, op, auth} -> relays a passkey-signed owner action (leash, revoke, setCap, setSeller).
export default (req: any, res: any) => route(req, res, async ({ account, op, auth }) => {
  if (!isHex(account, 20) || !isHex(op) || !auth) throw new Error("bad request");
  return submitOwner(account, op, auth);
}, { max: 30 });
