// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { GameUpgradeableV1 } from "../games/base/GameUpgradeableV1.sol";

contract GameUpgradeableV1Harness is Initializable, UUPSUpgradeable, OwnableUpgradeable, GameUpgradeableV1 {
    event ProcessBet(address placedBy, address token, uint256 amount, bytes data);
    event RequestLiquidity(uint256 requestId, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address platform_,
        address randomness_,
        address liquidity_
    ) GameUpgradeableV1(platform_, randomness_, liquidity_) {
        _disableInitializers();
    }

    function initialize(address initialOwner_) public initializer {
        __Ownable_init(initialOwner_);
    }

    function m_onlyRandomness() external onlyRandomness {}

    function maxExposure(address token_) external view returns (uint256) {
        return _maxExposure(token_);
    }

    function requestLiquidity(address token_, uint256 amount_) external onlyOwner {
        (uint256 requestId, uint256 amount) = _requestLiquidity(token_, amount_);
        emit RequestLiquidity(requestId, amount);
    }

    function settleLiquidityRequest(uint256 requestId_, address token_, uint256 incoming_, uint256 outgoing_) external {
        _settleLiquidityRequest(requestId_, token_, incoming_, outgoing_);
    }

    function _processBet(address placedBy_, address token_, uint256 amount_, bytes calldata data_) internal override {
        emit ProcessBet(placedBy_, token_, amount_, data_);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
