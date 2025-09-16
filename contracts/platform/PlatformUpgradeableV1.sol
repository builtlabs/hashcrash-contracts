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
import { ILegacyPlatform } from "../interfaces/ILegacyPlatform.sol";

import { BPS } from "../lib/BPS.sol";
import { TokenReceiver } from "../lib/TokenReceiver.sol";

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

    error MinimumNotFound();
    error InsufficientAmount();

    event MinimumAmountUpdated(address indexed game, address indexed token, uint256 minimum);
    event BetPlaced(address indexed placedBy, address indexed game, address indexed token, uint256 amount, uint256 fee);

    // #######################################################################################

    struct MinimumAmountUpdate {
        address game;
        address token;
        uint256 amount;
    }

    // #######################################################################################

    mapping(address => mapping(address => uint256)) private _minimumAmount;

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

    function getPlatform() external view returns (address) {
        return PLATFORM;
    }

    function getMinimum(address game_, address token_) external view returns (uint256) {
        return _getMinimum(game_, token_);
    }

    function getGameMinimums(address game_, address[] calldata tokens_) external view returns (uint256[] memory) {
        uint256[] memory minimums = new uint256[](tokens_.length);
        for (uint256 i = 0; i < tokens_.length; ) {
            minimums[i] = _getMinimum(game_, tokens_[i]);

            unchecked {
                ++i;
            }
        }
        return minimums;
    }

    // #######################################################################################

    function migrateAccounts(ILegacyPlatform legacy_, address[] calldata users_) external onlyOwner {
        for (uint256 i = 0; i < users_.length; ) {
            if (!_getAccountExists(users_[i])) {
                _createAccount(legacy_.getReferredBy(users_[i]));
            }

            unchecked {
                ++i;
            }
        }
    }

    function placeBet(address game_, address token_, uint256 amount_, bytes calldata data_) external payable {
        if (!_getAccountExists(msg.sender)) {
            _uncheckedCreateAccount(Account(true, address(0), 0));
        }

        uint256 minimum = _getMinimum(game_, token_);

        amount_ = _receiveValue(token_, amount_);

        (uint256 bet, uint256 fee) = _splitFee(amount_);
        _processFee(token_, fee);
        _processBet(game_, token_, bet, minimum, data_);

        emit BetPlaced(msg.sender, game_, token_, bet, fee);
    }

    // #######################################################################################

    function setMinimum(MinimumAmountUpdate calldata update_) external onlyOwner {
        _setMinimum(update_.game, update_.token, update_.amount);
    }

    function setMinimums(MinimumAmountUpdate[] calldata updates_) external onlyOwner {
        for (uint256 i = 0; i < updates_.length; ) {
            _setMinimum(updates_[i].game, updates_[i].token, updates_[i].amount);
            unchecked {
                ++i;
            }
        }
    }

    // #######################################################################################

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // #######################################################################################

    function _setMinimum(address game_, address token_, uint256 amount_) private {
        _minimumAmount[game_][token_] = amount_;
        emit MinimumAmountUpdated(game_, token_, amount_);
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

    function _getMinimum(address game_, address token_) private view returns (uint256 minimum) {
        minimum = _minimumAmount[game_][token_];
        if (minimum == 0) revert MinimumNotFound();
    }

    function _splitFee(uint256 amount_) private pure returns (uint256, uint256) {
        uint256 bet = BPS.reverse(amount_, PLATFORM_FEE);

        unchecked {
            amount_ -= bet;
        }

        return (bet, amount_);
    }
}
