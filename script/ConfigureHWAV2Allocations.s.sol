// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAEcosystemVesting} from "../src/hyperevm/HWAEcosystemVesting.sol";
import {HWAV2MigrationDistributor} from "../src/hyperevm/HWAV2MigrationDistributor.sol";

interface VmHWAV2Allocations {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBytes32(string calldata name) external returns (bytes32 value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Funds immutable migration and vesting contracts, retires excess supply, and leaves exactly 100M for seasons.
contract ConfigureHWAV2Allocations {
    VmHWAV2Allocations internal constant vm =
        VmHWAV2Allocations(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant LP_ALLOCATION = 125_000_000 ether;
    uint256 public constant REWARDS_ALLOCATION = 100_000_000 ether;
    uint256 public constant ECOSYSTEM_ALLOCATION = 100_000_000 ether;
    uint256 public constant MAX_MIGRATION_ALLOCATION = 675_000_000 ether;
    address public constant RETIRED_ALLOCATION = 0x000000000000000000000000000000000000dEaD;

    event HWAV2AllocationsConfigured(
        address indexed token,
        address indexed migrationDistributor,
        address indexed ecosystemVesting,
        uint256 migrationAllocation,
        uint256 rewardsReserved,
        uint256 ecosystemAllocation,
        uint256 retiredAllocation,
        uint64 snapshotBlock,
        bytes32 merkleRoot
    );

    error WrongChain(uint256 actual);
    error ConfirmationMissing();
    error InvalidConfig();
    error UnauthorizedOwner();
    error TransferFailed();

    function run()
        external
        returns (HWAV2MigrationDistributor migration, HWAEcosystemVesting vesting)
    {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (
            !vm.envBool("HWA_V2_SNAPSHOT_CONFIRMED") || !vm.envBool("HWA_V2_ALLOCATIONS_CONFIRMED")
                || (block.chainid == MAINNET && !vm.envBool("HWA_V2_MAINNET_ALLOCATION_CONFIRMED"))
        ) revert ConfirmationMissing();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("HWA_V2_TOKEN_ADDRESS")));
        address oldToken = vm.envAddress("HWA_V1_TOKEN_ADDRESS");
        address beneficiary = vm.envAddress("HWA_ECOSYSTEM_BENEFICIARY");
        bytes32 root = vm.envBytes32("HWA_V2_MIGRATION_MERKLE_ROOT");
        uint256 rawSnapshotBlock = vm.envUint("HWA_V2_SNAPSHOT_BLOCK");
        uint256 migrationAllocation = vm.envUint("HWA_V2_MIGRATION_ALLOCATION_WEI");

        if (
            address(token).code.length == 0 || oldToken.code.length == 0 || beneficiary == address(0)
                || root == bytes32(0) || rawSnapshotBlock == 0 || rawSnapshotBlock > block.number
                || rawSnapshotBlock > type(uint64).max || migrationAllocation == 0
                || migrationAllocation > MAX_MIGRATION_ALLOCATION
        ) revert InvalidConfig();
        if (token.owner() != owner) revert UnauthorizedOwner();
        if (
            token.totalSupply() != TOTAL_SUPPLY || token.balanceOf(owner) != TOTAL_SUPPLY - LP_ALLOCATION
                || token.externalBuysEnabled()
        ) revert InvalidConfig();

        uint256 retired = MAX_MIGRATION_ALLOCATION - migrationAllocation;
        vm.startBroadcast(ownerKey);
        migration = new HWAV2MigrationDistributor(
            address(token), oldToken, root, uint64(rawSnapshotBlock), migrationAllocation
        );
        vesting = new HWAEcosystemVesting(
            address(token), beneficiary, uint64(block.timestamp), ECOSYSTEM_ALLOCATION
        );
        token.setDistributor(address(migration), true);
        token.setDistributor(address(vesting), true);
        if (!token.transfer(address(migration), migrationAllocation)) revert TransferFailed();
        if (!token.transfer(address(vesting), ECOSYSTEM_ALLOCATION)) revert TransferFailed();
        if (retired != 0 && !token.transfer(RETIRED_ALLOCATION, retired)) revert TransferFailed();
        vm.stopBroadcast();

        if (
            token.balanceOf(address(migration)) != migrationAllocation || !migration.fullyFunded()
                || token.balanceOf(address(vesting)) != ECOSYSTEM_ALLOCATION
                || token.balanceOf(owner) != REWARDS_ALLOCATION || token.balanceOf(RETIRED_ALLOCATION) < retired
                || !token.isDistributor(address(migration)) || !token.isDistributor(address(vesting))
        ) revert InvalidConfig();

        emit HWAV2AllocationsConfigured(
            address(token),
            address(migration),
            address(vesting),
            migrationAllocation,
            REWARDS_ALLOCATION,
            ECOSYSTEM_ALLOCATION,
            retired,
            uint64(rawSnapshotBlock),
            root
        );
    }
}