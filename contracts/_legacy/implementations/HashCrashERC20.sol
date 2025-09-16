// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HashCrash } from "../HashCrash.sol";
import { TokenHolder } from "../currency/TokenHolder.sol";

/// @title HashCrashERC20
/// @notice A hashcrash implementation using a given ERC20 Token.
contract HashCrashERC20 is HashCrash {
    error NativeValueNotAllowed();

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

    function _receiveValue(address _from, uint256 _tokenValue) internal override returns (uint256) {
        if (msg.value > 0) revert NativeValueNotAllowed();
        return super._receiveValue(_from, _tokenValue);
    }
}
