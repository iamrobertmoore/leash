import type { Address } from "viem";
export const NETS = {
  testnet: { id: 10143, name: "Monad testnet", rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadvision.com",
    hub: "0x8b427106c04e66dfc6e8d58fa4de0478a54f510a" as Address, token: "0xd563843fc54be3e262df4ef3281f6ad397153197" as Address },
  mainnet: { id: 143, name: "Monad mainnet", rpc: "https://rpc.monad.xyz", explorer: "https://monadvision.com",
    hub: "0xecefc8c322e2aa77327c2b4912caec04323f4f37" as Address, token: "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3" as Address },
};
export const NET = NETS[(import.meta.env.VITE_LEASH_NETWORK as "testnet" | "mainnet") ?? "mainnet"] ?? NETS.mainnet;
export const ATTACKER = "0x000000000000000000000000000000000badF00D" as Address;
export const STATUS = ["OK", "UNKNOWN AGENT", "REVOKED", "EXPIRED", "SELLER NOT ALLOWED", "OVER CAP"];
