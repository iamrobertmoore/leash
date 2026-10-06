import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: false },
  },
  networks: {
    // Monad has the P256 precompile at 0x100; turn on the same thing locally.
    hardhat: { enableRip7212: true },
    monadTestnet: {
      url: process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    monadMainnet: {
      url: process.env.MONAD_MAINNET_RPC ?? "https://rpc.monad.xyz",
      chainId: 143,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
export default config;
