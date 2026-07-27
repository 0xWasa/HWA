// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {HWAGenesisNFT} from "../src/hyperevm/HWAGenesisNFT.sol";
import {FWATestnetNFT} from "../src/hyperevm/testnet/FWATestnetNFT.sol";

interface VmTestnetV2Fixtures {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys a frozen HWA Genesis snapshot plus gameplay/hostile fixtures for the v2 live campaign.
contract DeployTestnetV2Fixtures {
    VmTestnetV2Fixtures internal constant vm =
        VmTestnetV2Fixtures(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant TESTNET = 998;
    uint256 internal constant GENESIS_MAX_SUPPLY = 333;

    event TestnetV2FixturesDeployed(
        address indexed genesis,
        address indexed gameplay,
        address indexed hostile,
        address owner,
        address depositor,
        address purchaser,
        address snapshotHolder
    );

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error VerificationFailed();

    function run() external returns (HWAGenesisNFT genesis, FWATestnetNFT gameplay, FWATestnetNFT hostile) {
        if (block.chainid != TESTNET) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_TESTNET_V2_FIXTURES_CONFIRMED")) revert DeploymentNotConfirmed();
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envOr("FWA_OWNER", deployer);
        address depositor = vm.envOr("FWA_TEST_DEPOSITOR", deployer);
        address purchaser = vm.envOr("FWA_TEST_PURCHASER", deployer);
        address snapshotHolder = vm.envOr("FWA_TEST_SNAPSHOT_HOLDER", deployer);

        vm.startBroadcast(deployerKey);
        genesis = new HWAGenesisNFT(
            "Hyper World Assets Genesis", "HWAG", "ipfs://hwa-testnet-v2/genesis/", GENESIS_MAX_SUPPLY, deployer
        );
        address[] memory recipients = new address[](4);
        recipients[0] = deployer;
        recipients[1] = depositor;
        recipients[2] = purchaser;
        recipients[3] = snapshotHolder;
        genesis.batchMint(recipients);
        genesis.freezeSnapshot();

        gameplay =
            new FWATestnetNFT("HWA Testnet V2 Gameplay", "HWANFT-V2", "ipfs://hwa-testnet-v2/gameplay/", 6, deployer);
        gameplay.mint(depositor);
        gameplay.mint(depositor);
        gameplay.mint(purchaser);
        gameplay.mint(purchaser);
        gameplay.mint(deployer);
        gameplay.mint(snapshotHolder);
        gameplay.closeMinting();

        hostile =
            new FWATestnetNFT("HWA Testnet V2 Hostile", "HWAHOST-V2", "ipfs://hwa-testnet-v2/hostile/", 2, deployer);
        hostile.mint(depositor);
        hostile.mint(purchaser);
        hostile.closeMinting();
        hostile.setTransfersBlocked(true);

        if (finalOwner != deployer) {
            genesis.transferOwnership(finalOwner);
            gameplay.transferOwnership(finalOwner);
            hostile.transferOwnership(finalOwner);
        }
        vm.stopBroadcast();

        if (
            genesis.owner() != finalOwner || genesis.maxSupply() != GENESIS_MAX_SUPPLY || genesis.currentSupply() != 4
                || !genesis.snapshotFrozen() || gameplay.owner() != finalOwner || gameplay.getCurrentSupply() != 6
                || !gameplay.mintingClosed() || hostile.owner() != finalOwner || hostile.getCurrentSupply() != 2
                || !hostile.mintingClosed() || !hostile.transfersBlocked()
        ) revert VerificationFailed();

        emit TestnetV2FixturesDeployed(
            address(genesis), address(gameplay), address(hostile), finalOwner, depositor, purchaser, snapshotHolder
        );
    }
}

