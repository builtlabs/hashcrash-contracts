// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LootTable } from "../loot/LootTable.sol";

contract MockLootTable is LootTable {
    function _getLength() internal pure override returns (uint256) {
        return 1;
    }

    function _multiplier(uint256 _index) internal pure override returns (uint256) {
        return [2e6][_index]; // 2x
    }

    function _probability(uint256 _index) internal pure override returns (uint256) {
        return [5e17][_index]; // 50%
    }
}
