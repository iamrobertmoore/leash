import type { Address } from "viem";

export type LeashNetwork = {
  name: string;
  chainId: number;
  rpc: string;
  explorer: string;
  hub: Address;
  identityRegistry: Address;
  testUsd?: Address;
};

/** Live deployments. Mainnet is the default everywhere in this package. */
export const networks = {
  mainnet: {
    name: "Monad", chainId: 143, rpc: "https://rpc.monad.xyz", explorer: "https://monadvision.com",
    hub: "0xecefc8c322e2aa77327c2b4912caec04323f4f37",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    testUsd: "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3",
  },
  testnet: {
    name: "Monad Testnet", chainId: 10143, rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadvision.com",
    hub: "0x8b427106c04e66dfc6e8d58fa4de0478a54f510a",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    testUsd: "0xd563843fc54be3e262df4ef3281f6ad397153197",
  },
} satisfies Record<string, LeashNetwork>;
