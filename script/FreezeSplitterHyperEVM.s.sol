// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmFreezeSplitter {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Permanently freezes the reviewed 70/30 split without starting the revenue clock.
contract FreezeSplitterHyperEVM {
    VmFreezeSplitter internal constant vm = VmFreezeSplitter(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant MAINNET = 999;

    error WrongChain(uint256 actual);
    error FreezeNotConfirmed();
    error InvalidSplitterState();

    function run() external {
        if (block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_SPLITTER_FREEZE_CONFIRMED")) revert FreezeNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        MainnetOwnerPolicy.validateDeploymentOwner(
            vm.envAddress("FWA_OWNER"), owner, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED")
        );
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        if (
            address(splitter).code.length == 0 || splitter.owner() != owner || splitter.ownerShareBps() != 7_000
                || splitter.nftShareBps() != 3_000 || splitter.SNAPSHOT_SUPPLY() != 333
                || splitter.MAX_TOKEN_ID() != 333 || splitter.splitFrozen() || splitter.SWEEP_AVAILABLE_AT() != 0
        ) revert InvalidSplitterState();

        vm.startBroadcast(ownerKey);
        splitter.freezeSplit();
        vm.stopBroadcast();

        if (!splitter.splitFrozen() || splitter.SWEEP_AVAILABLE_AT() != 0) revert InvalidSplitterState();
    }
}
