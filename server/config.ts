import { defineChain, type Address } from "viem";

export const monadTestnet = defineChain({
  id: 10143, name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
});
export const monadMainnet = defineChain({
  id: 143, name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
});

type Net = { chain: typeof monadTestnet; hub: Address; token: Address; identity: Address };
const NETS: Record<string, Net> = {
  testnet: {
    chain: monadTestnet,
    hub: "0x8b427106c04e66dfc6e8d58fa4de0478a54f510a",
    token: "0xd563843fc54be3e262df4ef3281f6ad397153197",
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  },
  // filled in by the mainnet deploy (Thu)
  mainnet: {
    chain: monadMainnet,
    hub: "0x0000000000000000000000000000000000000000",
    token: "0x0000000000000000000000000000000000000000",
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  },
};
export const NET = NETS[process.env.LEASH_NETWORK ?? "testnet"];
export const DEMO = {
  capUsd: 5,
  attempts: 20,
  attemptUsd: 1,
  twinFundUsd: 20,
  accountFundUsd: 20,
  attacker: "0x000000000000000000000000000000000badF00D" as Address,
  agentGasMon: "0.6",
  payGas: 120_000n,
};
