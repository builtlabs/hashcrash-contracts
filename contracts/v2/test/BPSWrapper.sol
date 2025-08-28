// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BPS } from "../lib/BPS.sol";

contract BPSWrapper {
    function calculate(uint256 amount, uint256 bps) external pure returns (uint256) {
        return BPS.calculate(amount, bps);
    }

    function reverse(uint256 amount, uint256 bps) external pure returns (uint256) {
        return BPS.reverse(amount, bps);
    }
}
