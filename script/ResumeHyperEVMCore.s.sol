// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmResumeCore {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function envOr(string calldata name, address defaultValue) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Resumes the core deployment after the adapter and service were mined but the FWA
///         creation exceeded HyperEVM's 2M fast-block gas limit.
/// @dev The deployer must first opt into HyperEVM big blocks. This script refuses to duplicate
///      already-bound adapter/service instances or to use unexpected owners/providers.
contract ResumeHyperEVMCore {
    VmResumeCore internal constant vm = VmResumeCore(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant POP_VRNG_TESTNET = 0xd14D984603b0b7Ade91bE52f3Fc4A917Dfa77bcD;
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event CoreDeploymentResumed(
        uint256 indexed chainId,
        address indexed finalOwner,
        address fwa,
        address vrfService,
        address randomnessAdapter,
        address whitelist,
        address splitter
    );

    error WrongChain(uint256 actual);
    error ResumeNotConfirmed();
    error InvalidAddress();
    error InvalidExistingDeployment();
    error VerificationFailed();

    function run() external returns (FWA fwa, FWAWhitelist whitelist) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_CORE_RESUME_CONFIRMED")) revert ResumeNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envOr("FWA_OWNER", deployer);
        address splitterAddress = vm.envAddress("FWA_SPLITTER_ADDRESS");
        address adapterAddress = vm.envAddress("FWA_RANDOMNESS_ADAPTER_ADDRESS");
        address serviceAddress = vm.envAddress("FWA_VRF_SERVICE_ADDRESS");
        if (
            deployer == address(0) || finalOwner == address(0) || splitterAddress == address(0)
                || adapterAddress == address(0) || serviceAddress == address(0)
        ) revert InvalidAddress();

        PoPRandomnessAdapter adapter = PoPRandomnessAdapter(payable(adapterAddress));
        FWAVRFService service = FWAVRFService(payable(serviceAddress));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(splitterAddress));
        if (
            adapterAddress.code.length == 0 || serviceAddress.code.length == 0 || splitterAddress.code.length == 0
                || address(adapter.PROVIDER()) != POP_VRNG_TESTNET || adapter.owner() != deployer
                || adapter.consumer() != address(0) || service.owner() != deployer
                || address(service.fwa()) != address(0) || splitter.owner() != finalOwner
        ) revert InvalidExistingDeployment();

        uint256 gasEstimate = vm.envOr("FWA_RANDOMNESS_GAS_ESTIMATE", uint256(800_000));
        uint256 marginBps = vm.envOr("FWA_RANDOMNESS_MARGIN_BPS", uint256(3_000));
        uint256 flatWei = vm.envOr("FWA_RANDOMNESS_FLAT_WEI", uint256(0));

        vm.startBroadcast(deployerKey);

        fwa = new FWA(adapterAddress, adapter.SUBSCRIPTION_ID(), keccak256("POP_VRNG"), 900_000, serviceAddress);
        whitelist = new FWAWhitelist(address(fwa), address(0), 0, deployer);

        adapter.setConsumer(address(fwa));
        service.setFWA(address(fwa));
        service.setFeeConfig(gasEstimate, marginBps, flatWei);
        fwa.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        fwa.setAddr(FWAConfigKeys.PAYOUT_ADDRESS, splitterAddress);
        fwa.setUint(FWAConfigKeys.TOP_LISTING_SHARE_BPS, 100);

        if (finalOwner != deployer) {
            adapter.transferOwnership(finalOwner);
            service.transferOwnership(finalOwner);
            whitelist.transferOwnership(finalOwner);
            fwa.transferOwnership(finalOwner);
        }

        vm.stopBroadcast();

        if (
            fwa.owner() != finalOwner || whitelist.owner() != finalOwner || adapter.owner() != finalOwner
                || service.owner() != finalOwner || adapter.consumer() != address(fwa)
                || address(service.fwa()) != address(fwa) || fwa.payoutAddress() != splitterAddress
                || address(whitelist.fwa()) != address(fwa)
        ) revert VerificationFailed();

        emit CoreDeploymentResumed(
            block.chainid, finalOwner, address(fwa), serviceAddress, adapterAddress, address(whitelist), splitterAddress
        );
    }
}
