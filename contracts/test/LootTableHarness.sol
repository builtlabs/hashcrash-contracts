// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILootTable {
    function getLength() external view returns (uint256);

    function isDead(uint256 _rng, uint256 _index) external view returns (bool);
}

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
