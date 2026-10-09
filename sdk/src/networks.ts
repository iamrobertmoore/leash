import type { Address } from "viem";

export type LeashNetwork = {
  name: string;
  chainId: number;
  rpc: string;
  explorer: string;
  hub: Address;
  identityRegistry: Address;
  /** ERC-8004 Reputation Registry: where sellers leave a review of each agent they served or refused. */
  reputationRegistry?: Address;
  testUsd?: Address;
  /** Circle's USDC on this network, when there is one. */
  usdc?: Address;
};

/** Live deployments. Mainnet is the default everywhere in this package. */
export const networks = {
  mainnet: {
    name: "Monad", chainId: 143, rpc: "https://rpc.monad.xyz", explorer: "https://monadvision.com",
    hub: "0x64a489074dd6a4b3b977e5f635a178366a8c12c3",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    testUsd: "0x4adf40e6e5113339635e6dc54ff638e7b63bbea3",
    usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  },
  testnet: {
    name: "Monad Testnet", chainId: 10143, rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadvision.com",
    hub: "0x8b427106c04e66dfc6e8d58fa4de0478a54f510a",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    testUsd: "0xd563843fc54be3e262df4ef3281f6ad397153197",
  },
} satisfies Record<string, LeashNetwork>;
