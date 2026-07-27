// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWATestnetNFT} from "../src/hyperevm/testnet/FWATestnetNFT.sol";

interface VmTestnetNFTDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the controlled NFT fixtures required for live HyperEVM testnet E2E tests.
contract DeployTestnetNFTs {
    VmTestnetNFTDeploy internal constant vm =
        VmTestnetNFTDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event TestnetNFTsDeployed(
        address indexed snapshot,
        address indexed gameplay,
        address indexed hostile,
        address owner,
        address depositor,
        address purchaser,
        address snapshotHolder
    );

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error InvalidAddress();
    error VerificationFailed();

    function run() external returns (FWATestnetNFT snapshot, FWATestnetNFT gameplay, FWATestnetNFT hostile) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_TESTNFT_DEPLOYMENT_CONFIRMED")) revert DeploymentNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = _nonZeroOr("FWA_OWNER", deployer);
        address depositor = _nonZeroOr("FWA_TEST_DEPOSITOR", deployer);
        address purchaser = _nonZeroOr("FWA_TEST_PURCHASER", deployer);
        address snapshotHolder = _nonZeroOr("FWA_TEST_SNAPSHOT_HOLDER", deployer);
        if (deployer == address(0)) revert InvalidAddress();

        vm.startBroadcast(deployerKey);

        snapshot = new FWATestnetNFT("HWA Testnet Snapshot", "HWASNAP-T", "ipfs://hwa-testnet/snapshot/", 4, deployer);
        snapshot.mint(deployer);
        snapshot.mint(snapshotHolder);
        snapshot.mint(depositor);
        snapshot.mint(purchaser);
        snapshot.closeMinting();

        gameplay = new FWATestnetNFT("HWA Testnet Gameplay", "HWANFT-T", "ipfs://hwa-testnet/gameplay/", 6, deployer);
        gameplay.mint(depositor);
        gameplay.mint(depositor);
        gameplay.mint(purchaser);
        gameplay.mint(purchaser);
        gameplay.mint(deployer);
        gameplay.mint(snapshotHolder);
        gameplay.closeMinting();

        hostile = new FWATestnetNFT("HWA Testnet Hostile", "HWAHOST-T", "ipfs://hwa-testnet/hostile/", 2, deployer);
        hostile.mint(depositor);
        hostile.mint(purchaser);
        hostile.closeMinting();
        hostile.setTransfersBlocked(true);

        if (finalOwner != deployer) {
            snapshot.transferOwnership(finalOwner);
            gameplay.transferOwnership(finalOwner);
            hostile.transferOwnership(finalOwner);
        }

        vm.stopBroadcast();

        if (
            snapshot.owner() != finalOwner || gameplay.owner() != finalOwner || hostile.owner() != finalOwner
                || snapshot.getCurrentSupply() != 4 || gameplay.getCurrentSupply() != 6
                || hostile.getCurrentSupply() != 2 || snapshot.highestMintedTokenId() != 4 || !snapshot.mintingClosed()
                || !gameplay.mintingClosed() || !hostile.mintingClosed() || !hostile.transfersBlocked()
        ) revert VerificationFailed();

        emit TestnetNFTsDeployed(
            address(snapshot), address(gameplay), address(hostile), finalOwner, depositor, purchaser, snapshotHolder
        );
    }

    function _nonZeroOr(string memory name, address fallbackAddress) internal returns (address value) {
        value = vm.envOr(name, fallbackAddress);
        if (value == address(0)) value = fallbackAddress;
    }
}
