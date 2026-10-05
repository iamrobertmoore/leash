// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {WebAuthn} from "solady/src/utils/WebAuthn.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Subset of the ERC-8004 Identity Registry (v2) that Leash uses.
interface IIdentityRegistry {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    function register(string calldata agentURI, MetadataEntry[] calldata metadata) external returns (uint256 agentId);
}

interface ILeashHub {
    function link(address agent) external;
}

/// @title LeashAccount
/// @notice A smart account owned by one passkey. The passkey (P-256, verified on-chain through Monad's
/// native precompile at 0x100) is the only thing that can create, change or revoke an agent's leash.
/// Each agent key can only spend through `pay`, inside its daily cap, before its expiry, to allowed sellers.
/// Anyone can read an agent's leash with `check`, so a seller can decide before it serves the agent.
contract LeashAccount {
    using SafeERC20 for IERC20;

    enum Status {
        OK,
        UNKNOWN_AGENT,
        REVOKED,
        EXPIRED,
        SELLER_NOT_ALLOWED,
        OVER_CAP
    }

    struct Leash {
        address token; // what the agent spends (a stablecoin)
        uint128 dailyCap; // in token units, resets at 00:00 UTC
        uint128 spentToday;
        uint64 day; // day index of spentToday
        uint64 expiry; // unix seconds
        uint64 agentId; // ERC-8004 identity id
        bool active;
        bool anySeller; // true when no seller allow-list was set
    }

    bytes32 public ownerX;
    bytes32 public ownerY;
    address public hub;
    IIdentityRegistry public identity;
    uint256 public nonce;

    mapping(address agent => Leash) public leashes;
    mapping(address agent => mapping(address seller => bool)) public sellerAllowed;
    address[] internal _agents;

    event AgentLeashed(
        address indexed agent, uint256 indexed agentId, address token, uint256 dailyCap, uint64 expiry, bool anySeller
    );
    event SellerSet(address indexed agent, address indexed seller, bool allowed);
    event CapChanged(address indexed agent, uint256 dailyCap, uint64 expiry);
    event Revoked(address indexed agent);
    event Paid(
        address indexed agent, address indexed seller, address token, uint256 amount, bytes32 ref, uint256 remainingToday
    );
    event OwnerAction(uint256 indexed nonce, bytes4 selector);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error AlreadyInitialized();
    error OnlySelf();
    error BadSignature();
    error AgentExists();
    error InvalidLeash();
    error UnknownAgent();
    error AgentRevoked();
    error LeashExpired(uint64 expiry);
    error SellerNotAllowed(address seller);
    error OverCap(uint256 remainingToday, uint256 attempted);

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    /// @notice Called once by the hub right after the account is cloned.
    function initialize(bytes32 x, bytes32 y, address hub_, address identity_) external {
        if (hub != address(0)) revert AlreadyInitialized();
        ownerX = x;
        ownerY = y;
        hub = hub_;
        identity = IIdentityRegistry(identity_);
    }

    // ------------------------------------------------------------------ owner (passkey) path

    /// @notice The hash the passkey signs for the next owner action. WebAuthn puts it in the challenge.
    function opDigest(bytes calldata op, uint256 n) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), n, keccak256(op)));
    }

    /// @notice Runs one owner action, authorised by a WebAuthn assertion from the owner's passkey.
    /// Anyone can submit it (a relayer pays gas); only the passkey can authorise it.
    /// @param op ABI-encoded call to one of this contract's `onlySelf` functions.
    function ownerExecute(bytes calldata op, WebAuthn.WebAuthnAuth calldata auth) external returns (bytes memory) {
        uint256 n = nonce;
        bytes32 digest = opDigest(op, n);
        // requireUserVerification = true: Face ID / Touch ID / PIN must have been used.
        if (!WebAuthn.verify(abi.encodePacked(digest), true, auth, ownerX, ownerY)) revert BadSignature();
        nonce = n + 1;
        emit OwnerAction(n, bytes4(op[:4]));
        (bool ok, bytes memory ret) = address(this).call(op);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }

    /// @notice Put a new agent on a leash and register it under ERC-8004, owned by this account.
    function leash(
        address agent,
        address token,
        uint128 dailyCap,
        uint64 expiry,
        address[] calldata sellers,
        string calldata agentURI
    ) external onlySelf returns (uint256 agentId) {
        if (agent == address(0) || token == address(0) || dailyCap == 0 || expiry <= block.timestamp) {
            revert InvalidLeash();
        }
        if (leashes[agent].token != address(0)) revert AgentExists();

        IIdentityRegistry.MetadataEntry[] memory meta = new IIdentityRegistry.MetadataEntry[](2);
        meta[0] = IIdentityRegistry.MetadataEntry("leash.account", abi.encode(address(this)));
        meta[1] = IIdentityRegistry.MetadataEntry("leash.agentKey", abi.encode(agent));
        agentId = identity.register(agentURI, meta);

        bool anySeller = sellers.length == 0;
        leashes[agent] = Leash({
            token: token,
            dailyCap: dailyCap,
            spentToday: 0,
            day: _today(),
            expiry: expiry,
            agentId: uint64(agentId),
            active: true,
            anySeller: anySeller
        });
        for (uint256 i; i < sellers.length; ++i) {
            sellerAllowed[agent][sellers[i]] = true;
            emit SellerSet(agent, sellers[i], true);
        }
        _agents.push(agent);
        ILeashHub(hub).link(agent);
        emit AgentLeashed(agent, agentId, token, dailyCap, expiry, anySeller);
    }

    function setCap(address agent, uint128 dailyCap, uint64 expiry) external onlySelf {
        Leash storage l = leashes[agent];
        if (l.token == address(0)) revert UnknownAgent();
        if (dailyCap == 0 || expiry <= block.timestamp) revert InvalidLeash();
        l.dailyCap = dailyCap;
        l.expiry = expiry;
        emit CapChanged(agent, dailyCap, expiry);
    }

    function setSeller(address agent, address seller, bool allowed) external onlySelf {
        Leash storage l = leashes[agent];
        if (l.token == address(0)) revert UnknownAgent();
        sellerAllowed[agent][seller] = allowed;
        if (allowed) l.anySeller = false;
        emit SellerSet(agent, seller, allowed);
    }

    /// @notice One tap: the agent can never spend again.
    function revoke(address agent) external onlySelf {
        Leash storage l = leashes[agent];
        if (l.token == address(0)) revert UnknownAgent();
        l.active = false;
        emit Revoked(agent);
    }

    function withdraw(address token, address to, uint256 amount) external onlySelf {
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    // ------------------------------------------------------------------ agent path

    /// @notice The only way an agent key moves money. Every call is checked against its leash, on-chain.
    function pay(address seller, uint256 amount, bytes32 ref) external {
        Leash storage l = leashes[msg.sender];
        (Status s, uint256 remaining) = _status(l, msg.sender, seller, amount);
        if (s != Status.OK) _revertFor(s, l, seller, remaining, amount);

        uint64 today = _today();
        if (l.day != today) {
            l.day = today;
            l.spentToday = 0;
        }
        l.spentToday += uint128(amount);
        IERC20(l.token).safeTransfer(seller, amount);
        emit Paid(msg.sender, seller, l.token, amount, ref, remaining - amount);
    }

    // ------------------------------------------------------------------ public reads

    /// @notice What a seller asks before serving an agent: would this payment go through right now?
    function check(address agent, address seller, uint256 amount)
        external
        view
        returns (Status status, uint256 remainingToday, uint64 expiry, uint256 agentId)
    {
        Leash storage l = leashes[agent];
        (status, remainingToday) = _status(l, agent, seller, amount);
        return (status, remainingToday, l.expiry, l.agentId);
    }

    function agents() external view returns (address[] memory) {
        return _agents;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ------------------------------------------------------------------ internals

    function _today() internal view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    function _status(Leash storage l, address agent, address seller, uint256 amount)
        internal
        view
        returns (Status, uint256 remaining)
    {
        if (l.token == address(0)) return (Status.UNKNOWN_AGENT, 0);
        uint256 spent = l.day == _today() ? l.spentToday : 0;
        remaining = spent >= l.dailyCap ? 0 : l.dailyCap - spent;
        if (!l.active) return (Status.REVOKED, 0);
        if (block.timestamp >= l.expiry) return (Status.EXPIRED, 0);
        if (!l.anySeller && !sellerAllowed[agent][seller]) return (Status.SELLER_NOT_ALLOWED, remaining);
        if (amount > remaining) return (Status.OVER_CAP, remaining);
        return (Status.OK, remaining);
    }

    function _revertFor(Status s, Leash storage l, address seller, uint256 remaining, uint256 amount) internal view {
        if (s == Status.UNKNOWN_AGENT) revert UnknownAgent();
        if (s == Status.REVOKED) revert AgentRevoked();
        if (s == Status.EXPIRED) revert LeashExpired(l.expiry);
        if (s == Status.SELLER_NOT_ALLOWED) revert SellerNotAllowed(seller);
        revert OverCap(remaining, amount);
    }
}
