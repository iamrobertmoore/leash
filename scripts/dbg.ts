import { pub, prepareAgents } from "../server/relayer";
(async()=>{
 const acct="0x0ed2a580e7e125FCBF9945602A67F1C118223cfd" as const;
 const r=await prepareAgents(acct); console.log(r);
 for (const a of [r.agent,r.twin]) console.log(a, await pub.getBalance({address:a}));
})();
