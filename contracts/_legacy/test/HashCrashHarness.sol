// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HashCrash } from "../HashCrash.sol";
import { TokenHolder } from "../currency/TokenHolder.sol";

contract HashCrashHarness is HashCrash {
    constructor(
        address lootTable_,
        bytes32 genesisHash_,
        address hashProducer_,
        uint64 maxExposureNumerator_,
        uint256 lowLiquidityThreshold_,
        address owner_,
        address token_,
        uint256 minimumValue_
    )
        HashCrash(lootTable_, genesisHash_, hashProducer_, maxExposureNumerator_, lowLiquidityThreshold_, owner_)
        TokenHolder(token_, minimumValue_)
    {}

    function betOnAll(uint256 _amount, uint256 _length) external {
        for (uint256 i = 0; i < _length; i++) {
            (bool success, bytes memory data) = address(this).delegatecall(
                abi.encodeWithSignature("placeBet(uint256,uint64)", _amount, i)
            );

            if (!success) {
                if (data.length > 0) {
                    assembly {
                        revert(add(data, 32), mload(data))
                    }
                } else {
                    revert("Bet failed with no reason");
                }
            }
        }
    }

    function callOnLowLiquidity() external {
        _onLowLiquidity();
    }
}
