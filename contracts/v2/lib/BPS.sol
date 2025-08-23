// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BPS
/// @notice Library for handling basis points (bps) calculations
library BPS {
    uint256 constant _DENOMINATOR = 10_000;

    function calculate(uint256 amount, uint256 bps) internal pure returns (uint256) {
        unchecked {
            return (amount * bps) / _DENOMINATOR;
        }
    }
}
