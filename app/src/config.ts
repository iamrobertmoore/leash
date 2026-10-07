import type { Address } from "viem";
export const NETS = {
  testnet: { id: 10143, name: "Monad testnet", rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadvision.com", identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
    hub: "0x8b427106c04e66dfc6e8d58fa4de0478a54f510a" as Address, token: "0xd563843fc54be3e262df4ef3281f6ad397153197" as Address },
  mainnet: { id: 143, name: "Monad mainnet", rpc: "https://rpc.monad.xyz", explorer: "https://monadvision.com", identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
    hub: "0x64a489074dd6a4b3b977e5f635a178366a8c12c3" as Address, token: "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3" as Address },
};
export const NET = NETS[(import.meta.env.VITE_LEASH_NETWORK as "testnet" | "mainnet") ?? "mainnet"] ?? NETS.mainnet;
/** Circle's USDC on Monad mainnet (6 decimals), for owners leashing their own agent with real dollars. */
export const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;
export const ATTACKER = "0x000000000000000000000000000000000badF00D" as Address;
export const STATUS = ["OK", "UNKNOWN AGENT", "REVOKED", "EXPIRED", "SELLER NOT ALLOWED", "OVER CAP"];
