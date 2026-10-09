// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IIdentityAuth {
    function isAuthorizedOrOwner(address spender, uint256 id) external view returns (bool);
}

/// @notice Local stand-in for the ERC-8004 Reputation Registry, used only in tests. Same interface and rules as the
/// deployed registry for the parts Leash uses (Monad mainnet 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63).
contract MockReputationRegistry {
    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }

    IIdentityAuth public immutable identity;
    mapping(uint256 => address[]) internal _clients;
    mapping(uint256 => mapping(address => bool)) internal _known;
    mapping(uint256 => mapping(address => uint64)) public lastIndex;
    mapping(uint256 => mapping(address => mapping(uint64 => Feedback))) internal _fb;

    event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash);

    constructor(address identity_) {
        identity = IIdentityAuth(identity_);
    }

    function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string calldata tag1, string calldata tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external {
        require(!identity.isAuthorizedOrOwner(msg.sender, agentId), "Self-feedback not allowed");
        uint64 i = ++lastIndex[agentId][msg.sender];
        _fb[agentId][msg.sender][i] = Feedback(value, valueDecimals, tag1, tag2, false);
        if (!_known[agentId][msg.sender]) {
            _known[agentId][msg.sender] = true;
            _clients[agentId].push(msg.sender);
        }
        emit NewFeedback(agentId, msg.sender, i, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    struct Out {
        address[] c;
        uint64[] idx;
        int128[] values;
        uint8[] decs;
        string[] t1;
        string[] t2;
        bool[] revoked;
    }

    struct Query {
        uint256 agentId;
        address[] clients;
        bytes32 h1;
        bool f1;
        bytes32 h2;
        bool f2;
        bool includeRevoked;
    }

    function readAllFeedback(uint256 agentId, address[] memory clients, string memory tag1, string memory tag2, bool includeRevoked)
        external
        view
        returns (address[] memory, uint64[] memory, int128[] memory, uint8[] memory, string[] memory, string[] memory, bool[] memory)
    {
        Out memory o = _collect(Query(agentId, clients, keccak256(bytes(tag1)), bytes(tag1).length != 0, keccak256(bytes(tag2)), bytes(tag2).length != 0, includeRevoked));
        return (o.c, o.idx, o.values, o.decs, o.t1, o.t2, o.revoked);
    }

    function _collect(Query memory q) internal view returns (Out memory o) {
        uint256 agentId = q.agentId;
        address[] memory clients = q.clients;
        uint256 n;
        for (uint256 k; k < clients.length; ++k) n += lastIndex[agentId][clients[k]];
        o = Out(new address[](n), new uint64[](n), new int128[](n), new uint8[](n), new string[](n), new string[](n), new bool[](n));
        uint256 m;
        for (uint256 k; k < clients.length; ++k) {
            address cl = clients[k];
            for (uint64 i = 1; i <= lastIndex[agentId][cl]; ++i) {
                Feedback storage f = _fb[agentId][cl][i];
                if ((!q.includeRevoked && f.isRevoked) || (q.f1 && keccak256(bytes(f.tag1)) != q.h1) || (q.f2 && keccak256(bytes(f.tag2)) != q.h2)) continue;
                o.c[m] = cl; o.idx[m] = i; o.values[m] = f.value; o.decs[m] = f.valueDecimals;
                o.t1[m] = f.tag1; o.t2[m] = f.tag2; o.revoked[m] = f.isRevoked;
                ++m;
            }
        }
        _trim(o, m);
    }

    function _trim(Out memory o, uint256 m) internal pure {
        address[] memory c = o.c; uint64[] memory idx = o.idx; int128[] memory v = o.values; uint8[] memory d = o.decs;
        string[] memory t1 = o.t1; string[] memory t2 = o.t2; bool[] memory r = o.revoked;
        assembly {
            mstore(c, m) mstore(idx, m) mstore(v, m) mstore(d, m) mstore(t1, m) mstore(t2, m) mstore(r, m)
        }
    }
}
