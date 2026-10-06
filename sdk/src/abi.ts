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
