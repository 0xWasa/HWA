// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmSplitterDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy the FWA-parity native-HYPE splitter before deploying or binding the FWA core.
contract DeploySplitterHyperEVM {
    VmSplitterDeploy internal constant vm = VmSplitterDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    event SplitterHyperEVMDeployed(
        uint256 indexed chainId,
        address indexed splitter,
        address indexed snapshotNft,
        address owner,
        address secondaryOwner,
        uint256 snapshotSupply,
        uint256 maxTokenId
    );

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error MainnetNotConfirmed();
    error InvalidAddress();
    error InvalidSnapshot();

    function run() external returns (SplitterHyperEVM splitter) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("FWA_SPLITTER_DEPLOYMENT_CONFIRMED")) revert DeploymentNotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner =
            block.chainid == HYPEREVM_MAINNET_CHAIN_ID ? vm.envAddress("FWA_OWNER") : vm.envOr("FWA_OWNER", deployer);
        address secondaryOwner = vm.envAddress("FWA_SPLITTER_SECONDARY_OWNER");
        address snapshotNft = vm.envAddress("FWA_SPLITTER_SNAPSHOT_NFT");
        uint256 maxTokenId = vm.envUint("FWA_SPLITTER_MAX_TOKEN_ID");
        // The Ethereum reference explicitly allows a zero secondary recipient. In that configuration
        // the complete owner-side allocation is paid to `owner`; a non-zero secondary must still be
        // different from the owner to prevent a misleading double-recipient configuration.
        if (owner == address(0) || secondaryOwner == owner || snapshotNft == address(0)) {
            revert InvalidAddress();
        }
        if (
            snapshotNft.code.length == 0 || maxTokenId == 0
                || (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && owner.code.length == 0)
        ) revert InvalidSnapshot();

        vm.startBroadcast(deployerKey);
        splitter = new SplitterHyperEVM(owner, secondaryOwner, snapshotNft, maxTokenId);
        vm.stopBroadcast();

        if (
            splitter.owner() != owner || splitter.NFT_ADDRESS() != snapshotNft || splitter.MAX_TOKEN_ID() != maxTokenId
                || splitter.ownerShareBps() != 7_000 || splitter.nftShareBps() != 3_000
        ) revert InvalidSnapshot();

        emit SplitterHyperEVMDeployed(
            block.chainid, address(splitter), snapshotNft, owner, secondaryOwner, splitter.SNAPSHOT_SUPPLY(), maxTokenId
        );
    }
}
