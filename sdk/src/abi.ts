import { parseAbi } from "viem";
export const hubAbi = parseAbi([
  "function check(address agent, address seller, uint256 amount) view returns (uint8 status, uint256 remainingToday, uint64 expiry, uint256 agentId, address account)",
  "function accountOf(address agent) view returns (address)",
]);
export const accountAbi = parseAbi([
  "function pay(address seller, uint256 amount, bytes32 ref)",
  "function leashes(address) view returns (address token, uint128 dailyCap, uint128 spentToday, uint64 day, uint64 expiry, uint64 agentId, bool active, bool anySeller)",
  "event Paid(address indexed agent, address indexed seller, address token, uint256 amount, bytes32 ref, uint256 remainingToday)",
]);

/** ERC-8004 Reputation Registry (the parts Leash uses). */
export const reputationAbi = [
  { type: "function", name: "giveFeedback", stateMutability: "nonpayable", outputs: [], inputs: [
    { name: "agentId", type: "uint256" }, { name: "value", type: "int128" }, { name: "valueDecimals", type: "uint8" },
    { name: "tag1", type: "string" }, { name: "tag2", type: "string" }, { name: "endpoint", type: "string" },
    { name: "feedbackURI", type: "string" }, { name: "feedbackHash", type: "bytes32" }] },
  { type: "function", name: "getClients", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "readAllFeedback", stateMutability: "view", inputs: [
    { name: "agentId", type: "uint256" }, { name: "clientAddresses", type: "address[]" }, { name: "tag1", type: "string" },
    { name: "tag2", type: "string" }, { name: "includeRevoked", type: "bool" }], outputs: [
    { name: "clients", type: "address[]" }, { name: "feedbackIndexes", type: "uint64[]" }, { name: "values", type: "int128[]" },
    { name: "valueDecimals", type: "uint8[]" }, { name: "tag1s", type: "string[]" }, { name: "tag2s", type: "string[]" },
    { name: "revokedStatuses", type: "bool[]" }] },
] as const;
