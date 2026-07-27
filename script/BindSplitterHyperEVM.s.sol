// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";

import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmSplitterBind {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Testnet-only compatibility helper for an already deployed, unused FWA core.
/// @dev Mainnet binds the reviewed splitter atomically in DeployHyperEVMMainnetCore; this mutable
///      retrofit path is deliberately forbidden on chain 999.
contract BindSplitterHyperEVM {
    VmSplitterBind internal constant vm = VmSplitterBind(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event SplitterHyperEVMBound(address indexed fwa, address indexed splitter, address indexed owner);

    error BindingNotConfirmed();
    error WrongChain(uint256 actual);
    error UnauthorizedOwner();
    error CoreNotReady();
    error InvalidSplitter();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_SPLITTER_BINDING_CONFIRMED")) revert BindingNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        if (fwa.owner() != owner) revert UnauthorizedOwner();
        if (fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0) revert CoreNotReady();
        if (address(splitter).code.length == 0 || splitter.owner() != owner) revert InvalidSplitter();

        vm.startBroadcast(ownerKey);
        fwa.setAddr(FWAConfigKeys.PAYOUT_ADDRESS, address(splitter));
        vm.stopBroadcast();

        if (fwa.payoutAddress() != address(splitter)) revert InvalidSplitter();
        emit SplitterHyperEVMBound(address(fwa), address(splitter), owner);
    }
}
