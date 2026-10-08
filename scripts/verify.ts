// Checks the README's claims against Monad mainnet, live. No keys, no funds: reads only.
//   npm run verify        (same checks as: npx leash-monad verify)
import { verify } from "../sdk/src/verify";
verify().then((failed) => process.exit(failed ? 1 : 0));
