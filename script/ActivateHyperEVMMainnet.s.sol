// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {DrandBN254Coordinator} from "../src/hyperevm/DrandBN254Coordinator.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {HWAProjectXLiquidityLocker} from "../src/hyperevm/HWAProjectXLiquidityLocker.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmActivateHyperEVMMainnet {
    function envAddress(string calldata name) external view returns (address value);
    function envBool(string calldata name) external view returns (bool value);
}

/// @notice Historical filename retained for operator compatibility; this is now a read-only
///         activation-readiness attestation. It never opens gameplay or public token buys.
contract ActivateHyperEVMMainnet {
    VmActivateHyperEVMMainnet internal constant vm =
        VmActivateHyperEVMMainnet(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;
    uint256 internal constant TOTAL_EMISSION = 300_000_000 ether;

    error WrongChain(uint256 actual);
    error ReleaseGateNotConfirmed();
    error InvalidWiring();

    /// @dev Redundancy remains the preferred operating mode. A single relayer
    ///      may only pass the release attestation through an explicit,
    ///      separately named acknowledgement of its liveness/fairness risk.
    function _drandOperationsAccepted(bool redundancyConfirmed, bool singleRelayerRiskAccepted)
        internal
        pure
        returns (bool)
    {
        return redundancyConfirmed || singleRelayerRiskAccepted;
    }

    function run() external view {
        if (block.chainid != HYPEREVM_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);
        bool drandOperationsAccepted = _drandOperationsAccepted(
            vm.envBool("DRAND_RELAYER_REDUNDANCY_CONFIRMED"), vm.envBool("DRAND_SINGLE_RELAYER_RISK_ACCEPTED")
        );
        if (
            !vm.envBool("MAINNET_ACTIVATION_CONFIRMED") || !vm.envBool("MAINNET_SOURCE_VERIFICATION_CONFIRMED")
                || !drandOperationsAccepted || !vm.envBool("PROJECTX_E2E_CONFIRMED")
                || !vm.envBool("INDEXER_DEPLOYMENT_CONFIRMED")
        ) revert ReleaseGateNotConfirmed();

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWAVRFService service = FWAVRFService(payable(vm.envAddress("FWA_VRF_SERVICE_ADDRESS")));
        DrandBN254Coordinator coordinator =
            DrandBN254Coordinator(payable(vm.envAddress("FWA_DRAND_BN254_COORDINATOR_ADDRESS")));
        FWAWhitelist whitelist = FWAWhitelist(vm.envAddress("FWA_WHITELIST_ADDRESS"));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_PROJECTX_ADAPTER_ADDRESS")));
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(token.liquidityLocker());
        address finalOwner = fwa.owner();
        MainnetOwnerPolicy.validateConfiguredOwner(
            finalOwner, vm.envAddress("FWA_OWNER"), vm.envBool("MAINNET_EOA_OWNER_CONFIRMED")
        );

        (address activeCoordinator, uint256 subId) = fwa.vrfCoordinatorAndSubId();
        (,,, address subscriptionOwner, address[] memory consumers) = coordinator.getSubscription(subId);
        if (
            activeCoordinator != address(coordinator) || subId != coordinator.SUBSCRIPTION_ID()
                || coordinator.consumer() != address(fwa) || coordinator.owner() != finalOwner
                || subscriptionOwner != finalOwner || consumers.length != 1 || consumers[0] != address(fwa)
                || coordinator.pendingRequestCount() != 0 || !coordinator.launchReady()
                || address(service.fwa()) != address(fwa) || address(fwa.vrfService()) != address(service)
                || service.owner() != finalOwner || whitelist.fwa() != address(fwa) || whitelist.owner() != finalOwner
                || fwa.payoutAddress() != address(splitter) || splitter.owner() != finalOwner
                || splitter.ownerShareBps() != 7_000 || splitter.nftShareBps() != 3_000 || !splitter.splitFrozen()
                || (splitter.SWEEP_AVAILABLE_AT() != 0 && splitter.SWEEP_AVAILABLE_AT() <= block.timestamp)
                || address(fwa.rewards()) != address(rewards) || rewards.fwa() != address(fwa)
                || rewards.token() != address(token) || address(rewards.swapAdapter()) != address(adapter)
                || rewards.owner() != finalOwner || adapter.owner() != finalOwner || token.owner() != finalOwner
                || locker.owner() != finalOwner || !locker.bound() || locker.tokenId() != token.lpTokenId()
                || rewards.depositorRatePerSec() == 0 || rewards.purchaserDailyPot() == 0
                || rewards.emissionStart() != 0 || token.balanceOf(address(rewards)) < TOTAL_EMISSION
                || token.adapter() != address(adapter) || token.rewardsPool() != address(rewards)
                || token.externalBuysEnabled() || fwa.acquisitionsEnabled() || !fwa.rewardsRequiredForActivation()
                || token.buybackSqrtPriceLimitX96() == 0 || !token.buybackOracleReady()
                || token.buybackMinOutPerHypeX96() == 0
        ) revert InvalidWiring();
    }
}
