// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LootTable } from "./LootTable.sol";

/// @title FixedRTP100x
/// @notice A loot table with 50 entries, starting at 1.01x and ending at 100x, with a constant expected RTP of 0.97.
contract FixedRTP100x is LootTable {
    function _getLength() internal pure override returns (uint256) {
        return 50;
    }

    function _multiplier(uint256 _index) internal pure override returns (uint256) {
        return
            [
                1010000,
                1050000,
                1100000,
                1150000,
                1200000,
                1250000,
                1300000,
                1400000,
                1500000,
                2000000,
                2200000,
                2400000,
                2600000,
                2800000,
                3000000,
                3250000,
                3500000,
                4000000,
                4500000,
                5000000,
                6000000,
                7000000,
                8000000,
                9000000,
                10000000,
                12000000,
                14000000,
                16000000,
                18000000,
                20000000,
                22500000,
                25000000,
                27500000,
                30000000,
                32500000,
                35000000,
                37500000,
                40000000,
                45000000,
                50000000,
                55000000,
                60000000,
                65000000,
                70000000,
                75000000,
                80000000,
                85000000,
                90000000,
                95000000,
                100000000
            ][_index];
    }

    function _probability(uint256 _index) internal pure override returns (uint256) {
        return
            [
                39603960396039640,
                38095238095238130,
                45454545454545490,
                43478260869565096,
                41666666666666664,
                39999999999999980,
                38461538461538616,
                71428571428571330,
                66666666666666720,
                249999999999999940,
                90909090909090860,
                83333333333333330,
                76923076923076930,
                71428571428571464,
                66666666666666870,
                76923076923076740,
                71428571428571400,
                125000000000000200,
                111111111111111100,
                100000000000000000,
                166666666666666660,
                142857142857142660,
                125000000000000200,
                111111111111111100,
                100000000000000000,
                166666666666666660,
                142857142857142660,
                124999999999999410,
                111111111111111920,
                100000000000000000,
                111111111111111100,
                100000000000001040,
                90909090909090640,
                83333333333332540,
                76923076923076400,
                71428571428572500,
                66666666666664530,
                62500000000001610,
                111111111111111100,
                100000000000001040,
                90909090909087790,
                83333333333335440,
                76923076923076400,
                71428571428568776,
                66666666666668270,
                62499999999997310,
                58823529411769550,
                55555555555555016,
                52631578947370590,
                49999999999993470
            ][_index];
    }
}
