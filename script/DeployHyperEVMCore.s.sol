// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Phase-1 deployment: core, exact Ethereum VRF service, PoP adapter and whitelist.
/// @dev Acquisitions intentionally remain disabled until PoP manually registers the adapter and
///      ActivateHyperEVMCore is run with an approved collection list.
contract DeployHyperEVMCore {
    VmDeploy internal constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant POP_VRNG_TESTNET = 0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD;
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event CoreDeployed(
        uint256 indexed chainId,
        address indexed finalOwner,
        address fwa,
        address vrfService,
        address randomnessAdapter,
        address whitelist,
        address proofOfPlayProvider
    );

    error WrongChain(uint256 actual);
    error InvalidOwner();
    error InvalidSplitter();

    function run()
        external
        returns (FWA fwa, FWAVRFService service, PoPRandomnessAdapter adapter, FWAWhitelist whitelist)
    {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envOr("FWA_OWNER", deployer);
        if (finalOwner == address(0)) revert InvalidOwner();
        address splitter = vm.envOr("FWA_SPLITTER_ADDRESS", address(0));
        if (
            splitter == address(0) || splitter.code.length == 0
                || SplitterHyperEVM(payable(splitter)).owner() != finalOwner
        ) revert InvalidSplitter();

        uint256 minimumBuffer = vm.envOr("FWA_MIN_RANDOMNESS_BUFFER_WEI", uint256(1));
        uint256 maxFulfillmentCost = vm.envOr("FWA_MAX_RANDOMNESS_COST_WEI", uint256(1));
        uint256 gasEstimate = vm.envOr("FWA_RANDOMNESS_GAS_ESTIMATE", uint256(800_000));
        uint256 marginBps = vm.envOr("FWA_RANDOMNESS_MARGIN_BPS", uint256(3_000));
        uint256 flatWei = vm.envOr("FWA_RANDOMNESS_FLAT_WEI", uint256(0));

        vm.startBroadcast(deployerKey);

        adapter = new PoPRandomnessAdapter(POP_VRNG_TESTNET, deployer);
        service = new FWAVRFService(minimumBuffer, maxFulfillmentCost);
        fwa = new FWA(address(adapter), adapter.SUBSCRIPTION_ID(), keccak256("POP_VRNG"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(fwa), address(0), 0, deployer);

        adapter.setConsumer(address(fwa));
        service.setFWA(address(fwa));
        service.setFeeConfig(gasEstimate, marginBps, flatWei);
        fwa.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        fwa.setAddr(FWAConfigKeys.PAYOUT_ADDRESS, splitter);
        fwa.setUint(FWAConfigKeys.TOP_LISTING_SHARE_BPS, 100);

        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            service.transferOwnership(finalOwner);
            whitelist.transferOwnership(finalOwner);
            fwa.transferOwnership(finalOwner);
        }

        vm.stopBroadcast();

        emit CoreDeployed(
            block.chainid,
            finalOwner,
            address(fwa),
            address(service),
            address(adapter),
            address(whitelist),
            POP_VRNG_TESTNET
        );
    }
}
