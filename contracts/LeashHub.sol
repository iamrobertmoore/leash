// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LeashAccount} from "./LeashAccount.sol";

/// @title LeashHub
/// @notice Creates one LeashAccount per passkey and answers the seller's question in one call:
/// "if this agent pays me this much, will it go through, and whose agent is it?"
contract LeashHub {
    address public immutable implementation;
    address public immutable identity;

    mapping(address agent => address account) public accountOf;
    mapping(address account => bool) public isAccount;

    event AccountCreated(address indexed account, bytes32 x, bytes32 y);
    event AgentLinked(address indexed agent, address indexed account);

    error NotAccount();
    error AgentTaken();

    constructor(address identity_) {
        identity = identity_;
        implementation = address(new LeashAccount());
    }

    function salt(bytes32 x, bytes32 y) public pure returns (bytes32) {
        return keccak256(abi.encode(x, y));
    }

    function predict(bytes32 x, bytes32 y) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, salt(x, y));
    }

    /// @notice Same passkey, same account address, on any device. Idempotent.
    function createAccount(bytes32 x, bytes32 y) external returns (address account) {
        account = predict(x, y);
        if (account.code.length != 0) return account;
        Clones.cloneDeterministic(implementation, salt(x, y));
        LeashAccount(account).initialize(x, y, address(this), identity);
        isAccount[account] = true;
        emit AccountCreated(account, x, y);
    }

    function link(address agent) external {
        if (!isAccount[msg.sender]) revert NotAccount();
        address current = accountOf[agent];
        if (current != address(0) && current != msg.sender) revert AgentTaken();
        accountOf[agent] = msg.sender;
        emit AgentLinked(agent, msg.sender);
    }

    /// @notice The seller-side check. An agent with no leash comes back UNKNOWN_AGENT (status 1).
    function check(address agent, address seller, uint256 amount)
        external
        view
        returns (
            LeashAccount.Status status,
            uint256 remainingToday,
            uint64 expiry,
            uint256 agentId,
            address account
        )
    {
        account = accountOf[agent];
        if (account == address(0)) return (LeashAccount.Status.UNKNOWN_AGENT, 0, 0, 0, address(0));
        (status, remainingToday, expiry, agentId) = LeashAccount(account).check(agent, seller, amount);
    }
}
