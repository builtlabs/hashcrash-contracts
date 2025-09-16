// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LootTable } from "../loot/LootTable.sol";

contract PredictableDeathTable is LootTable {
    function _getLength() internal pure override returns (uint256) {
        return 5;
    }

    function _multiplier(uint256 _index) internal pure override returns (uint256) {
        return [1000000, 1500000, 2000000, 2500000, 3000000][_index];
    }

    function _probability(uint256 _index) internal pure override returns (uint256) {
        return [0, 0, 0, 1e18, 0][_index];
    }
}
