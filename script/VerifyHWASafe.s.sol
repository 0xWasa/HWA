// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ISafe} from "../src/hyperevm/interfaces/ISafe.sol";

interface VmVerifyHWASafe {
    function envAddress(string calldata name) external view returns (address value);
}

/// @notice Read-only post-deployment attestation for the frozen HWA Safe configuration.
contract VerifyHWASafe {
    VmVerifyHWASafe internal constant vm = VmVerifyHWASafe(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    address internal constant EXPECTED_SAFE = 0x75818fd0a2Ff801F974C9a5d23616fbd38b15f4C;
    address internal constant SIGNER_1 = 0x645b7e2A32cfF5e131a3D6Cf16155e006fe74F5c;
    address internal constant SIGNER_2 = 0x487F29A5C4eE0669D40d77Cd78F5b6A95046fECB;
    address internal constant SIGNER_3 = 0x10B327d693F223399F2D8151B2B97a66818FF681;
    address internal constant SENTINEL_MODULES = address(0x1);

    error WrongChain(uint256 actual);
    error InvalidSafe();

    function run() external view {
        if (block.chainid != HYPEREVM_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);
        address safeAddress = vm.envAddress("FWA_OWNER");
        if (safeAddress != EXPECTED_SAFE || safeAddress.code.length == 0) revert InvalidSafe();

        ISafe safe = ISafe(safeAddress);
        address[] memory owners = safe.getOwners();
        (address[] memory modules, address next) = safe.getModulesPaginated(SENTINEL_MODULES, 10);
        if (
            owners.length != 3 || safe.getThreshold() != 2
                || keccak256(bytes(safe.VERSION())) != keccak256(bytes("1.4.1")) || !safe.isOwner(SIGNER_1)
                || !safe.isOwner(SIGNER_2) || !safe.isOwner(SIGNER_3) || modules.length != 0 || next != SENTINEL_MODULES
        ) revert InvalidSafe();
    }
}
