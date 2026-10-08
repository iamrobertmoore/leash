#!/usr/bin/env node
// npx leash-monad verify   -> checks Leash's claims against Monad mainnet (read-only)
import { verify } from "./verify";

const cmd = process.argv[2];
if (cmd === "verify") verify().then((f) => process.exit(f ? 1 : 0));
else {
  console.log("leash-monad: spend limits for AI agents on Monad\n\n  npx leash-monad verify   check every claim against Monad mainnet (reads only)\n\nLibrary: import { checkAgent, leashGate } from \"leash-monad\"  ·  https://leash-monad.vercel.app");
}
