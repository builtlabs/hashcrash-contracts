// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { HashCrash } from "../HashCrash.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MaliciousBetter {
    function multiBet(HashCrash _game, IERC20 _token, uint256 _bets, uint256 _amount, uint64 _cashoutIndex) external {
        for (uint256 i = 0; i < _bets; i++) {
            UniqueAddressHack hack = new UniqueAddressHack();
            _token.transfer(address(hack), _amount);
            hack.bet(_game, _token, _amount, _cashoutIndex);
        }
    }

    function multiBetCancel(
        HashCrash _game,
        IERC20 _token,
        uint256 _bets,
        uint256 _amount,
        uint64 _cashoutIndex,
        uint256 _startIndex
    ) external {
        for (uint256 i = 0; i < _bets; i++) {
            UniqueAddressHack hack = new UniqueAddressHack();
            _token.transfer(address(hack), _amount);
            hack.bet(_game, _token, _amount, _cashoutIndex);
            hack.cancel(_game, _startIndex + i);
        }
    }

    function multiBetNative(HashCrash _game, uint256 _bets, uint256 _amount, uint64 _cashoutIndex) external payable {
        for (uint256 i = 0; i < _bets; i++) {
            UniqueAddressHack hack = new UniqueAddressHack();
            hack.betNative{ value: _amount }(_game, _amount, _cashoutIndex);
        }
    }

    function multiBetCancelNative(
        HashCrash _game,
        uint256 _bets,
        uint256 _amount,
        uint64 _cashoutIndex,
        uint256 _startIndex
    ) external payable {
        for (uint256 i = 0; i < _bets; i++) {
            UniqueAddressHack hack = new UniqueAddressHack();
            hack.betNative{ value: _amount }(_game, _amount, _cashoutIndex);
            hack.cancel(_game, _startIndex + i);
        }
    }
}

contract UniqueAddressHack {
    function bet(HashCrash _game, IERC20 _token, uint256 _amount, uint64 _cashoutIndex) external {
        _token.approve(address(_game), _amount);
        _game.placeBet(_amount, _cashoutIndex);
    }

    function betNative(HashCrash _game, uint256 _amount, uint64 _cashoutIndex) external payable {
        _game.placeBet{ value: _amount }(_amount, _cashoutIndex);
    }

    function cancel(HashCrash _game, uint256 _index) external {
        _game.cancelBet(_index);
    }
}
