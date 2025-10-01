// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { AccountsUpgradeableV1 } from "./accounts/AccountsUpgradeableV1.sol";
import { RewardsUpgradeableV1 } from "./rewards/RewardsUpgradeableV1.sol";

import { IGame } from "../interfaces/IGame.sol";
import { ILegacyPlatform } from "../interfaces/ILegacyPlatform.sol";

import { BPS } from "../lib/BPS.sol";
import { NativeHolder } from "../lib/NativeHolder.sol";

contract PlatformUpgradeableV1 is
    NativeHolder,
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

    error GameModeInactive();
    error InsufficientAmount();

    event GameModeAdded(address indexed game, address indexed token, uint256 minBetAmount);
    event GameModeUpdated(address indexed game, address indexed token, uint256 minBetAmount);

    event BetPlaced(address indexed placedBy, address indexed game, address indexed token, uint256 amount, uint256 fee);

    // #######################################################################################

    struct GameToken {
        address game;
        address token;
    }

    struct GameMode {
        address game;
        address token;
        uint256 minBetAmount;
    }

    // #######################################################################################

    mapping(address => mapping(address => uint256)) private _minBetAmount;

    // #######################################################################################

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address platform_, address weth_) NativeHolder(weth_) {
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
        return _minBetAmount[game_][token_];
    }

    function getGameMinimums(address game_, address[] calldata tokens_) external view returns (uint256[] memory) {
        uint256[] memory minimums = new uint256[](tokens_.length);
        for (uint256 i = 0; i < tokens_.length; ) {
            minimums[i] = _minBetAmount[game_][tokens_[0]];

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
        uint256 minBet = _minBetAmount[game_][token_];
        if (minBet == 0) revert GameModeInactive();

        if (!_getAccountExists(msg.sender)) {
            _uncheckedCreateAccount(Account(true, address(0), 0));
        }

        amount_ = _receiveToken(token_, amount_) + _receiveEther(token_);

        (uint256 bet, uint256 fee) = _splitFee(amount_);
        _processFee(token_, fee);
        _processBet(game_, token_, bet, minBet, data_);

        emit BetPlaced(msg.sender, game_, token_, bet, fee);
    }

    // #######################################################################################

    function addGameMode(address game_, address token_, uint256 minBetAmount_) external onlyOwner {
        _addGameMode(game_, token_, minBetAmount_);
    }

    function addGameModes(GameMode[] calldata modes_) external onlyOwner {
        for (uint256 i = 0; i < modes_.length; ) {
            _addGameMode(modes_[i].game, modes_[i].token, modes_[i].minBetAmount);

            unchecked {
                ++i;
            }
        }
    }

    function updateGameMode(address game_, address token_, uint256 minBetAmount_) external onlyOwner {
        _updateGameMode(game_, token_, minBetAmount_);
    }

    function updateGameModes(GameMode[] calldata modes_) external onlyOwner {
        for (uint256 i = 0; i < modes_.length; ) {
            _updateGameMode(modes_[i].game, modes_[i].token, modes_[i].minBetAmount);

            unchecked {
                ++i;
            }
        }
    }

    // #######################################################################################

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // #######################################################################################

    function _addGameMode(address game_, address token_, uint256 minBetAmount_) private {
        _approveToken(token_, game_, type(uint256).max);
        IGame(game_).enableToken(token_);

        if (minBetAmount_ == 0) revert InsufficientAmount();

        _minBetAmount[game_][token_] = minBetAmount_;
        emit GameModeAdded(game_, token_, minBetAmount_);
    }

    function _updateGameMode(address game_, address token_, uint256 minBetAmount_) private {
        _minBetAmount[game_][token_] = minBetAmount_;
        emit GameModeUpdated(game_, token_, minBetAmount_);
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
        IGame(game_).processBet(msg.sender, token_, amount_, data_);
    }

    function _splitFee(uint256 amount_) private pure returns (uint256, uint256) {
        uint256 bet = BPS.reverse(amount_, PLATFORM_FEE);

        unchecked {
            amount_ -= bet;
        }

        return (bet, amount_);
    }
}
