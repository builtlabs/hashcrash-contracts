// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AccountsUpgradeableV1 } from "./accounts/AccountsUpgradeableV1.sol";
import { RewardsUpgradeableV1 } from "./rewards/RewardsUpgradeableV1.sol";

import { IGame } from "../interfaces/IGame.sol";
import { TokenReceiver } from "../lib/TokenReceiver.sol";
import { BPS } from "../lib/BPS.sol";

contract PlatformUpgradeableV1 is
    TokenReceiver,
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    RewardsUpgradeableV1,
    AccountsUpgradeableV1
{
    uint256 private constant PLATFORM_FEE = 100;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable PLATFORM;

    // #######################################################################################

    error AlreadyRegistered();
    error InsufficientAmount();
    error RegistrationNotFound(uint8 kind);

    event Registered(address indexed target, bool enabled, uint8 kind, uint240 min);
    event RegistrationMinUpdated(address indexed target, uint240 min);
    event RegistrationEnabledUpdated(address indexed target, bool enabled);

    // #######################################################################################

    struct CreateRegistration {
        address target;
        Registration registration;
    }

    struct Registration {
        bool enabled;
        uint8 kind;
        uint240 min;
    }

    // #######################################################################################

    mapping(address => Registration) private _registrations;

    // #######################################################################################

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address platform_, address weth_) TokenReceiver(weth_) {
        PLATFORM = platform_;

        _disableInitializers();
    }

    function initialize(address owner_) public initializer {
        __Ownable_init(owner_);
    }

    // #######################################################################################

    function getRegistration(address target_, uint8 kind_) external view returns (Registration memory) {
        return _getRegistration(target_, kind_);
    }

    // #######################################################################################

    function placeBet(address game_, address token_, uint256 amount_, bytes calldata data_) external payable {
        if (!_getAccountExists(msg.sender)) {
            _markSenderAsExists();
        }

        Registration memory game = _getRegistration(game_, GAME_KIND);
        Registration memory token = _getRegistration(token_, TOKEN_KIND);

        amount_ = _receiveValue(token_, amount_);

        (uint256 fee, uint256 play) = _splitFee(amount_, token.min);
        _processFee(token_, fee);
        _processBet(game_, token_, play, game.min, data_);
    }

    // #######################################################################################

    function register(CreateRegistration calldata _create) external onlyOwner {
        _register(_create.target, _create.registration);
    }

    function registerMultiple(CreateRegistration[] calldata _create) external onlyOwner {
        for (uint256 i = 0; i < _create.length; ) {
            _register(_create[i].target, _create[i].registration);
            unchecked {
                ++i;
            }
        }
    }

    function updateRegistrationMin(address target_, uint8 kind_, uint240 min_) external onlyOwner {
        Registration storage registration = _getRegistrationRef(target_, kind_);

        registration.min = min_;
        emit RegistrationMinUpdated(target_, min_);
    }

    function updateRegistrationEnabled(address target_, uint8 kind_, bool enabled_) external onlyOwner {
        Registration storage registration = _getRegistrationRef(target_, kind_);

        registration.enabled = enabled_;
        emit RegistrationEnabledUpdated(target_, enabled_);
    }

    // #######################################################################################

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // #######################################################################################

    function _register(address target_, Registration calldata registration_) private {
        if (_registrations[target_].kind != 0) revert AlreadyRegistered();

        _registrations[target_] = registration_;
        emit Registered(target_, registration_.enabled, registration_.kind, registration_.min);
    }

    function _processFee(address token_, uint256 amount_) private {
        uint256 remainder = amount_;

        uint256 depth = 0;
        address referrer = _getReferredBy(msg.sender);
        while (referrer != address(0)) {
            uint256 reward = _getReferralBPS(depth, _getReferralCount(referrer));

            if (reward == 0) break;

            reward = BPS.calculate(amount_, reward);
            _allocateReward(token_, referrer, reward);

            unchecked {
                ++depth;
                remainder -= reward;
            }

            referrer = _getReferredBy(referrer);
        }

        _allocateReward(token_, PLATFORM, remainder);
    }

    function _processBet(address game_, address token_, uint256 amount_, uint256 min_, bytes calldata data_) private {
        if (amount_ < min_) revert InsufficientAmount();

        IERC20(token_).transfer(address(game_), amount_);
        IGame(game_).processBet(msg.sender, token_, amount_, data_);
    }

    function _getRegistration(address target_, uint8 kind_) private view returns (Registration memory) {
        Registration memory registration = _registrations[target_];
        if (!registration.enabled || registration.kind != kind_) revert RegistrationNotFound(kind_);
        return registration;
    }

    function _getRegistrationRef(address target_, uint8 kind_) private view returns (Registration storage) {
        Registration storage registration = _registrations[target_];
        if (!registration.enabled || registration.kind != kind_) revert RegistrationNotFound(kind_);
        return registration;
    }

    function _splitFee(uint256 amount_, uint256 min_) private pure returns (uint256, uint256) {
        uint256 fee = BPS.reverse(amount_, PLATFORM_FEE);

        if (fee < min_) {
            fee = min_;
        }

        if (amount_ < fee) revert InsufficientAmount();

        unchecked {
            amount_ -= fee;
        }

        return (fee, amount_);
    }
}
