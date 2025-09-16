// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ILootTable } from "../interfaces/ILootTable.sol";

contract LootTableHarness {
    ILootTable private immutable _sut;

    constructor(ILootTable _lootTable) {
        _sut = _lootTable;
    }

    function deadOn(uint256[] memory _rngs) external view returns (uint256) {
        uint256 length = _sut.getLength();

        for (uint256 i = 0; i < length; i++) {
            if (_sut.isDead(_rngs[i], i)) {
                return i;
            }
        }
        return length;
    }
}
