// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title Placeholder
/// @author @builtbyfrancis
contract Placeholder is UUPSUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address public immutable OWNER = msg.sender;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function _authorizeUpgrade(address) internal view override {
        require(msg.sender == OWNER, "Placeholder: not owner");
    }
}

/// @title ERC1967ProxyFactory
/// @author @builtbyfrancis
contract ERC1967ProxyFactory is Ownable {
    address public immutable IMPLEMENTATION;

    event ProxyDeployed(address proxy);
    event ImplementationDeployed(address implementation);

    // #######################################################################################

    constructor() Ownable(msg.sender) {
        IMPLEMENTATION = address(new Placeholder());
    }

    // #######################################################################################

    function computeProxyAddress(bytes32 salt_) external view returns (address) {
        return Create2.computeAddress(salt_, keccak256(_proxyCode()));
    }

    function computeImplAddress(bytes32 salt_, bytes calldata code_) external view returns (address) {
        return Create2.computeAddress(salt_, keccak256(code_));
    }

    // #######################################################################################

    function deployProxy(bytes32 salt_) external onlyOwner {
        emit ProxyDeployed(Create2.deploy(0, salt_, _proxyCode()));
    }

    function deployImpl(
        UUPSUpgradeable proxy_,
        bytes32 salt_,
        bytes calldata code_,
        bytes calldata initData_
    ) external onlyOwner {
        address impl = Create2.deploy(0, salt_, code_);
        proxy_.upgradeToAndCall(impl, initData_);
        emit ImplementationDeployed(impl);
    }

    // #######################################################################################

    function _proxyCode() private view returns (bytes memory) {
        return abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(IMPLEMENTATION));
    }
}
