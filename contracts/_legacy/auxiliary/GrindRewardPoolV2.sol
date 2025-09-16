// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IVRFSystem } from "../interfaces/IVRFSystem.sol";
import { IVRFSystemCallback } from "../interfaces/IVRFSystemCallback.sol";

/// @title GrindRewardPoolV2
/// @author BuiltByFrancis
/// @notice Kickback and rewards distribution.
contract GrindRewardPoolV2 is IVRFSystemCallback {
    IVRFSystem private immutable _vrfSystem;
    IERC20 private immutable _grind;
    address private immutable _owner;

    // #######################################################################################

    error UnauthorizedRequest();
    error InvalidRewardAmount();
    error NoTicketsForLotto();
    error LottoNotFound();

    // #######################################################################################

    event KickbackSent(address indexed account, uint256 amount);

    event LottoTicketsStored(uint256 indexed lottoId, uint256 tickets, uint256 cumulativeTickets, address ticketOwner);
    event LottoDrawRequested(uint256 indexed lottoId, uint256 requestId, uint256 reward);
    event LottoDrawCompleted(
        uint256 indexed lottoId,
        uint256 requestId,
        uint256 randomNumber,
        uint256 payout,
        address winner
    );

    // #######################################################################################

    struct AddressAmount {
        address account;
        uint256 amount;
    }

    struct LottoRequest {
        uint256 lottoId;
        uint256 reward;
    }

    struct LottoTicket {
        address user;
        uint256 amount;
        uint256 cumulative;
    }

    // #######################################################################################

    mapping(uint256 => LottoTicket[]) private _lottoRounds;
    mapping(uint256 => LottoRequest) private _requestIdToLotto;

    // #######################################################################################

    uint256 private _nextLottoId = 1;

    // #######################################################################################

    modifier onlyOwner() {
        if (msg.sender != _owner) revert UnauthorizedRequest();
        _;
    }

    // #######################################################################################

    /// @notice Constructor initializes the contract with the given parameters.
    /// @param owner_ The owner of the contract.
    constructor(address vrf_, address grind_, address owner_) {
        _vrfSystem = IVRFSystem(vrf_);
        _grind = IERC20(grind_);
        _owner = owner_;
    }

    // #######################################################################################

    /// @notice Retrieves the owner of the contract.
    function owner() external view returns (address) {
        return _owner;
    }

    /// @notice Retrieves the grind token used in the reward pool.
    function grind() external view returns (IERC20) {
        return _grind;
    }

    /// @notice Retrieves the VRF system used for random number generation.
    function vrfSystem() external view returns (IVRFSystem) {
        return _vrfSystem;
    }

    /// @notice Retrieves the next lotto ID to be used.
    function nextLottoId() external view returns (uint256) {
        return _nextLottoId;
    }

    /// @notice Retrieves the total number of tickets for a specific lotto round.
    /// @param lottoId_ The ID of the lotto round to retrieve the total tickets for
    function getTotalTickets(uint256 lottoId_) external view returns (uint256) {
        return _totalTickets(_lottoRounds[lottoId_]);
    }

    /// @notice Retrieves the lotto tickets for a specific lotto round.
    /// @param lottoId_ The ID of the lotto round to retrieve tickets for
    function getLottoTickets(uint256 lottoId_) external view returns (LottoTicket[] memory) {
        return _lottoRounds[lottoId_];
    }

    /// @notice Retrieves the lotto request associated with a specific request ID.
    /// @param requestId_ The ID of the request to retrieve the lotto information for
    function requestIdToLotto(uint256 requestId_) external view returns (LottoRequest memory) {
        return _requestIdToLotto[requestId_];
    }

    // #######################################################################################

    /// @notice Sends kickbacks to specified addresses.
    /// @param kickbacks_ An array of AddressAmount structs containing the addresses and amounts to send
    function sendKickbacks(AddressAmount[] calldata kickbacks_) external onlyOwner {
        for (uint256 i = 0; i < kickbacks_.length; ) {
            AddressAmount memory kickback = kickbacks_[i];

            _grind.transfer(kickback.account, kickback.amount);
            emit KickbackSent(kickback.account, kickback.amount);

            unchecked {
                i++;
            }
        }
    }

    /// @notice Stores lotto tickets for a specific lotto round.
    /// @param lottoTickets_ An array of AddressAmount structs containing the tickets to store
    function storeTickets(AddressAmount[] calldata lottoTickets_) external onlyOwner {
        uint256 lottoId = _nextLottoId;
        LottoTicket[] storage lottoRound = _lottoRounds[lottoId];

        uint256 cumulative = lottoRound.length == 0 ? 0 : lottoRound[lottoRound.length - 1].cumulative;
        for (uint256 i = 0; i < lottoTickets_.length; ) {
            AddressAmount memory ticket = lottoTickets_[i];

            unchecked {
                cumulative += ticket.amount;
                i++;
            }

            lottoRound.push(LottoTicket({ user: ticket.account, amount: ticket.amount, cumulative: cumulative }));

            emit LottoTicketsStored(lottoId, ticket.amount, cumulative, ticket.account);
        }
    }

    /// @notice Requests a lotto draw for the next lotto ID with a specified reward.
    /// @param reward_ The reward amount for the lotto draw
    function requestLottoDraw(uint256 reward_) external onlyOwner {
        uint256 lottoId = _nextLottoId;

        if (reward_ == 0) revert InvalidRewardAmount();
        if (_lottoRounds[lottoId].length == 0) revert NoTicketsForLotto();

        uint256 requestId = _vrfSystem.requestRandomNumberWithTraceId(lottoId);
        _requestIdToLotto[requestId] = LottoRequest({ lottoId: lottoId, reward: reward_ });
        emit LottoDrawRequested(lottoId, requestId, reward_);

        unchecked {
            _nextLottoId = lottoId + 1;
        }
    }

    /// @notice Callback function to handle the random number fulfillment from the VRF system.
    /// @param requestId_ The ID of the request for which the random number is being fulfilled
    /// @param randomNumber_ The random number generated by the VRF system
    function randomNumberCallback(uint256 requestId_, uint256 randomNumber_) external override {
        if (msg.sender != address(_vrfSystem)) revert UnauthorizedRequest();

        uint256 lottoId = _requestIdToLotto[requestId_].lottoId;
        uint256 reward = _requestIdToLotto[requestId_].reward;

        if (lottoId == 0) revert LottoNotFound();

        delete _requestIdToLotto[requestId_];

        address winner = _findWinner(randomNumber_, _lottoRounds[lottoId]);
        _grind.transfer(winner, reward);
        emit LottoDrawCompleted(lottoId, requestId_, randomNumber_, reward, winner);
    }

    // #######################################################################################

    function _findWinner(uint256 randomNumber_, LottoTicket[] storage tickets_) private view returns (address) {
        uint256 cumulative = randomNumber_ % _totalTickets(tickets_);
        uint256 left = 0;
        uint256 right = tickets_.length;

        while (left < right) {
            uint256 mid = (left + right) / 2;
            if (tickets_[mid].cumulative <= cumulative) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        return tickets_[left].user;
    }

    function _totalTickets(LottoTicket[] storage tickets_) private view returns (uint256) {
        return tickets_.length == 0 ? 0 : tickets_[tickets_.length - 1].cumulative;
    }
}
