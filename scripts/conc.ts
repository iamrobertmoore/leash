import { createAccount, prepareAgents } from "../server/relayer";
import { softPasskey } from "../lib/webauthn";
(async () => {
  const run = async (i: number) => { const pk = softPasskey(); try { const a = await createAccount(pk.x, pk.y); await prepareAgents(a); return `ok ${i}`; } catch (e: any) { return `ERR ${i}: ${e.details ?? ""} | ${e.shortMessage ?? e.message}`.slice(0, 400); } };
  console.log(await Promise.all([run(1), run(2), run(3)]));
})();
