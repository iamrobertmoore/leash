import { parseAbi } from "viem";
export const hubAbi = parseAbi([
  "function createAccount(bytes32 x, bytes32 y) returns (address)",
  "function predict(bytes32 x, bytes32 y) view returns (address)",
  "function accountOf(address agent) view returns (address)",
  "function check(address agent, address seller, uint256 amount) view returns (uint8 status, uint256 remainingToday, uint64 expiry, uint256 agentId, address account)",
]);
export const accountAbi = parseAbi([
  "struct WebAuthnAuth { bytes authenticatorData; string clientDataJSON; uint256 challengeIndex; uint256 typeIndex; bytes32 r; bytes32 s; }",
  "function ownerExecute(bytes op, WebAuthnAuth auth) returns (bytes)",
  "function opDigest(bytes op, uint256 n) view returns (bytes32)",
  "function nonce() view returns (uint256)",
  "function leash(address agent, address token, uint128 dailyCap, uint64 expiry, address[] sellers, string agentURI) returns (uint256)",
  "function revoke(address agent)",
  "function setCap(address agent, uint128 dailyCap, uint64 expiry)",
  "function setSeller(address agent, address seller, bool allowed)",
  "function setBrief(address agent, bytes sealedBrief)",
  "function withdraw(address token, address to, uint256 amount)",
  "function pay(address seller, uint256 amount, bytes32 ref)",
  "function leashes(address) view returns (address token, uint128 dailyCap, uint128 spentToday, uint64 day, uint64 expiry, uint64 agentId, bool active, bool anySeller)",
  "function check(address agent, address seller, uint256 amount) view returns (uint8, uint256, uint64, uint256)",
  "function ownerX() view returns (bytes32)",
  "function agents() view returns (address[])",
  "event Paid(address indexed agent, address indexed seller, address token, uint256 amount, bytes32 ref, uint256 remainingToday)",
]);
export const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
export const STATUS = ["OK", "UNKNOWN_AGENT", "REVOKED", "EXPIRED", "SELLER_NOT_ALLOWED", "OVER_CAP"] as const;
