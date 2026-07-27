// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmSplitterTest {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice One-time chain-998 smoke test of the live 70/30 Splitter with all four fixture holders.
contract TestSplitterHyperEVM {
    VmSplitterTest internal constant vm = VmSplitterTest(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event SplitterTested(address indexed splitter, uint256 funded, uint256 ownerAllocated, uint256 nftAllocated);

    error WrongChain(uint256 actual);
    error TestNotConfirmed();
    error InvalidState();
    error InvalidActor();
    error FundingFailed();
    error VerificationFailed();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_SPLITTER_TEST_CONFIRMED")) revert TestNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        uint256 snapshotHolderKey = vm.envUint("FWA_TEST_SNAPSHOT_HOLDER_PRIVATE_KEY");
        uint256 depositorKey = vm.envUint("FWA_TEST_DEPOSITOR_PRIVATE_KEY");
        uint256 purchaserKey = vm.envUint("FWA_TEST_PURCHASER_PRIVATE_KEY");
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        uint256 amount = vm.envOr("FWA_SPLITTER_TEST_WEI", uint256(0.001 ether));

        if (
            amount == 0 || splitter.totalReceived() != 0 || splitter.ownerClaimed() != 0 || splitter.claimed(1) != 0
                || splitter.claimed(2) != 0 || splitter.claimed(3) != 0 || splitter.claimed(4) != 0
        ) revert InvalidState();
        if (
            vm.addr(ownerKey) != splitter.NFT().ownerOf(1) || vm.addr(snapshotHolderKey) != splitter.NFT().ownerOf(2)
                || vm.addr(depositorKey) != splitter.NFT().ownerOf(3)
                || vm.addr(purchaserKey) != splitter.NFT().ownerOf(4)
        ) revert InvalidActor();

        vm.startBroadcast(ownerKey);
        (bool sent,) = address(splitter).call{value: amount}("");
        if (!sent) revert FundingFailed();
        splitter.claimOwner();
        splitter.claim(_single(1));
        vm.stopBroadcast();

        vm.startBroadcast(snapshotHolderKey);
        splitter.claim(_single(2));
        vm.stopBroadcast();

        vm.startBroadcast(depositorKey);
        splitter.claim(_single(3));
        vm.stopBroadcast();

        vm.startBroadcast(purchaserKey);
        splitter.claim(_single(4));
        vm.stopBroadcast();

        uint256 perToken = splitter.claimablePerToken();
        if (
            splitter.totalReceived() != amount || splitter.ownerAllocated() + splitter.nftAllocated() != amount
                || splitter.ownerClaimed() != splitter.ownerAllocated() || splitter.claimed(1) != perToken
                || splitter.claimed(2) != perToken || splitter.claimed(3) != perToken || splitter.claimed(4) != perToken
                || address(splitter).balance != 0
        ) revert VerificationFailed();

        emit SplitterTested(address(splitter), amount, splitter.ownerAllocated(), splitter.nftAllocated());
    }

    function _single(uint256 tokenId) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = tokenId;
    }
}
