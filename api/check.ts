import { route, isHex } from "./_util";
import { check, NET } from "../server/relayer";
import { STATUS } from "../server/abi";
// GET ?agent=&seller=&amount= -> the seller-side check, as JSON. The SDK does the same read straight from chain.
export default (req: any, res: any) => route(req, res, async ({ agent, seller, amount }) => {
  if (!isHex(agent, 20) || !isHex(seller, 20)) throw new Error("agent and seller must be addresses");
  const r = await check(agent, seller, Number(amount ?? 1));
  return { ...r, statusName: STATUS[r.status], chainId: NET.chain.id, hub: NET.hub };
}, { max: 120 });
