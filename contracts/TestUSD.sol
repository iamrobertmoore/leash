// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet dollar for the demo (6 decimals, like USDC). Anyone can mint up to $100 per call.
contract TestUSD is ERC20 {
    error TooMuch();

    constructor() ERC20("Leash Test Dollar", "tUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > 100e6) revert TooMuch();
        _mint(to, amount);
    }
}
