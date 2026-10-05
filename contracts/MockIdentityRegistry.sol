// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Local stand-in for the ERC-8004 Identity Registry, used only in tests.
/// Deployed networks use the real registry (Monad testnet 0x8004A818BFB912233c491871b3d84c89A494BD9e).
contract MockIdentityRegistry is ERC721 {
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    uint256 public lastId;
    mapping(uint256 => mapping(string => bytes)) public metadata;
    mapping(uint256 => string) public uris;

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register(string calldata agentURI, MetadataEntry[] calldata meta) external returns (uint256 id) {
        id = ++lastId;
        _safeMint(msg.sender, id);
        uris[id] = agentURI;
        for (uint256 i; i < meta.length; ++i) {
            metadata[id][meta[i].metadataKey] = meta[i].metadataValue;
        }
    }

    function getMetadata(uint256 id, string calldata key) external view returns (bytes memory) {
        return metadata[id][key];
    }
}
