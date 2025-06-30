// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title GrindRewardPool
/// @author BuiltByFrancis
/// @notice A traceable, points to grind converter.
contract GrindRewardPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 private immutable _grind;

    // #######################################################################################

    event SeasonOpened(uint256 indexed seasonId);
    event GrindPopulated(uint256 indexed seasonId, uint256 grindAmount);
    event PointsPopulated(uint256 indexed seasonId, address indexed account, uint256 points);
    event GrindClaimed(uint256 indexed seasonId, address indexed account, uint256 grindAmount, uint256 points);

    error InvalidAmount();
    error NothingToClaim();
    error InvalidSeasonId();
    error SeasonHasNoGrind();
    error SeasonHasNoPoints();
    error InvalidAccountAddress();
    error DuplicateAccountInPoints();

    struct PointData {
        address account;
        uint256 points;
    }

    // #######################################################################################

    uint256 private _nextSeasonId;

    mapping(uint256 => uint256) private _seasonTotalGrind;
    mapping(uint256 => uint256) private _seasonTotalPoints;
    mapping(uint256 => mapping(address => uint256)) private _seasonPoints;

    // #######################################################################################

    modifier onlyNextSeason(uint256 seasonId_) {
        if (seasonId_ != _nextSeasonId) revert InvalidSeasonId();
        _;
    }

    // #######################################################################################

    /// @notice Constructor initializes the contract with the given parameters.
    /// @param owner_ The owner of the contract.
    constructor(address grind_, address owner_) Ownable(owner_) {
        _grind = IERC20(grind_);
    }

    // #######################################################################################

    /// @notice Retrieves the grind token used in the reward pool.
    function grind() external view returns (IERC20) {
        return _grind;
    }

    /// @notice Retrieves the next season ID.
    function nextSeasonId() external view returns (uint256) {
        return _nextSeasonId;
    }

    /// @notice Retrieves the total grind amount for a specific season.
    /// @param seasonId_ The ID of the season to retrieve total grind for.
    function seasonTotalGrind(uint256 seasonId_) external view returns (uint256) {
        return _seasonTotalGrind[seasonId_];
    }

    /// @notice Retrieves the total points accumulated for a specific season.
    /// @param seasonId_ The ID of the season to retrieve total points for.
    function seasonTotalPoints(uint256 seasonId_) external view returns (uint256) {
        return _seasonTotalPoints[seasonId_];
    }

    /// @notice Retrieves the points accumulated by an account for a specific season.
    /// @param seasonId_ The ID of the season to retrieve points for.
    /// @param account_ The address of the account to retrieve points for.
    function seasonPoints(uint256 seasonId_, address account_) external view returns (uint256) {
        return _seasonPoints[seasonId_][account_];
    }

    /// @notice Calculates the grind amount for a given season and account based on the points accumulated.
    /// @param seasonId_ The ID of the season to calculate grind for.
    /// @param account_ The address of the account to calculate grind for.
    /// @return The calculated grind amount for the specified season and account.
    function seasonGrind(uint256 seasonId_, address account_) external view returns (uint256) {
        return _pointsToGrind(seasonId_, _seasonPoints[seasonId_][account_]);
    }

    // #######################################################################################

    /// @notice Opens a new season for claiming grind.
    /// @param seasonId_ The ID of the season to open.
    function openClaim(uint256 seasonId_) external onlyOwner onlyNextSeason(seasonId_) {
        if (_seasonTotalGrind[seasonId_] == 0) revert SeasonHasNoGrind();
        if (_seasonTotalPoints[seasonId_] == 0) revert SeasonHasNoPoints();

        emit SeasonOpened(seasonId_);
        unchecked {
            _nextSeasonId++;
        }
    }

    /// @notice Populates the grind for a season.
    /// @param seasonId_ The ID of the season to populate grind for.
    /// @param grindAmount_ The amount of grind to populate for the season.
    function populateGrind(uint256 seasonId_, uint256 grindAmount_) external onlyOwner onlyNextSeason(seasonId_) {
        if (grindAmount_ == 0) revert InvalidAmount();

        _grind.safeTransferFrom(msg.sender, address(this), grindAmount_);

        unchecked {
            _seasonTotalGrind[seasonId_] += grindAmount_;
        }

        emit GrindPopulated(seasonId_, grindAmount_);
    }

    /// @notice Populates the points for a season.
    /// @param seasonId_ The ID of the season to populate points for.
    /// @param pointData_ An array of PointData containing account addresses and their corresponding points.
    /// @dev this function expects unique accounts in the PointData array.
    function populatePoints(
        uint256 seasonId_,
        PointData[] calldata pointData_
    ) external onlyOwner onlyNextSeason(seasonId_) {
        for (uint256 i = 0; i < pointData_.length; i++) {
            PointData memory data = pointData_[i];

            if (data.points == 0) revert InvalidAmount();
            if (data.account == address(0)) revert InvalidAccountAddress();
            if (_seasonPoints[seasonId_][data.account] != 0) revert DuplicateAccountInPoints();
            _seasonPoints[seasonId_][data.account] = data.points;

            unchecked {
                _seasonTotalPoints[seasonId_] += data.points;
            }

            emit PointsPopulated(seasonId_, data.account, data.points);
        }
    }

    // #######################################################################################

    /// @notice Claims the grind for a specific season based on the points accumulated.
    /// @param seasonId_ The ID of the season to claim grind for.
    function claimGrind(uint256 seasonId_) external {
        if (seasonId_ >= _nextSeasonId) revert InvalidSeasonId();

        uint256 points = _seasonPoints[seasonId_][msg.sender];
        _seasonPoints[seasonId_][msg.sender] = 0;

        if (points == 0) revert NothingToClaim();

        uint256 grindAmount = _pointsToGrind(seasonId_, points);
        _grind.safeTransfer(msg.sender, grindAmount);

        emit GrindClaimed(seasonId_, msg.sender, grindAmount, points);
    }

    // #######################################################################################

    function _pointsToGrind(uint256 seasonId_, uint256 points_) internal view returns (uint256) {
        return (points_ * _seasonTotalGrind[seasonId_]) / _seasonTotalPoints[seasonId_];
    }
}
