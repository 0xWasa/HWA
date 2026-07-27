// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWANestLiquidityLocker} from "../src/hyperevm/FWANestLiquidityLocker.sol";
import {FWANestPlugin} from "../src/hyperevm/FWANestPlugin.sol";
import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {INestAlgebraPool} from "../src/hyperevm/interfaces/INestAlgebra.sol";

interface VmNestVerify {
    function envAddress(string calldata name) external returns (address value);
}

contract VerifyNestModules {
    VmNestVerify internal constant vm = VmNestVerify(address(uint160(uint256(keccak256("hevm cheat code")))));

    event NestModulesVerified(
        address indexed token,
        address indexed rewards,
        address indexed adapter,
        address pool,
        address plugin,
        address liquidityLocker
    );

    error MissingCode(address target);
    error InvalidWiring();

    uint256 internal constant INITIAL_TOKEN_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant TOTAL_EMISSION = 300_000_000 ether;
    bytes32 internal constant TOKEN_NAME_HASH = keccak256("Hyper World Assets");
    bytes32 internal constant TOKEN_SYMBOL_HASH = keccak256("HWA");
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    error WrongChain(uint256 actual);

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWANestSwapAdapter adapter = FWANestSwapAdapter(payable(vm.envAddress("FWA_NEST_ADAPTER_ADDRESS")));
        FWANestPlugin plugin = FWANestPlugin(token.plugin());
        FWANestLiquidityLocker locker = FWANestLiquidityLocker(token.liquidityLocker());
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        INestAlgebraPool pool = INestAlgebraPool(token.pool());

        _requireCode(address(fwa));
        _requireCode(address(token));
        _requireCode(address(rewards));
        _requireCode(address(adapter));
        _requireCode(address(plugin));
        _requireCode(address(locker));
        _requireCode(address(splitter));
        _requireCode(address(pool));

        (uint160 price,, uint16 lastFee, uint8 config, uint16 communityFee,) = pool.globalState();
        address finalOwner = fwa.owner();
        address expectedFeeRecipient = vm.envAddress("FWA_NEST_FEE_RECIPIENT");
        if (
            keccak256(bytes(token.name())) != TOKEN_NAME_HASH || keccak256(bytes(token.symbol())) != TOKEN_SYMBOL_HASH
                || !token.marketInitialized() || !token.launched() || token.initialSqrtPriceX96() == 0 || price == 0
                // Buybacks deliberately burn part of the initial supply. A strict equality here
                // becomes stale immediately after the first successful buyback, so attest the
                // immutable cap direction instead: supply must remain non-zero and can only fall
                // below the one-billion deployment supply.
                || token.totalSupply() == 0 || token.totalSupply() > INITIAL_TOKEN_SUPPLY || token.POOL_FEE() != 10_000
                || token.POOL_TICK_SPACING() != 60 || pool.plugin() != address(plugin) || pool.fee() != 10_000
                || pool.tickSpacing() != 60 || lastFee != 10_000 || config != 7 || communityFee != 0
                || plugin.deploymentBlock() == 0 || address(plugin.POOL()) != address(pool)
                || address(plugin.TOKEN()) != address(token) || plugin.WHYPE() != token.WHYPE() || !locker.bound()
                || locker.tokenId() != token.lpTokenId()
                || locker.POSITION_MANAGER().ownerOf(token.lpTokenId()) != address(locker)
                || locker.owner() != finalOwner || locker.feeRecipient() != expectedFeeRecipient
                || !token.isDistributor(expectedFeeRecipient) || token.adapter() != address(adapter)
                || token.rewardsPool() != address(rewards) || address(adapter.FACTORY()) != address(token.FACTORY())
                || address(adapter.TOKEN()) != address(token) || adapter.WHYPE() != token.WHYPE()
                || adapter.POOL() != address(pool) || adapter.POOL_FEE() != 10_000 || adapter.TICK_SPACING() != 60
                || adapter.rewardsBuyer() != address(rewards) || rewards.token() != address(token)
                || address(rewards.swapAdapter()) != address(adapter) || rewards.fwa() != address(fwa)
                || address(fwa.rewards()) != address(rewards) || token.owner() != finalOwner
                || rewards.owner() != finalOwner || adapter.owner() != finalOwner || rewards.depositorRatePerSec() == 0
                || rewards.purchaserDailyPot() == 0 || token.buybackSqrtPriceLimitX96() == 0
                || token.buybackMinOutPerHypeX96() == 0 || token.routeDepositorBps() != 4_000
                || token.routePurchaserBps() != 4_000 || token.routeBurnBps() != 2_000 || fwa.token() != address(token)
                || fwa.payoutAddress() != address(splitter) || splitter.owner() != fwa.owner()
                || splitter.ownerShareBps() != 7_000 || splitter.nftShareBps() != 3_000
                || token.FACTORY().poolByPair(token.WHYPE(), address(token)) != address(pool)
        ) revert InvalidWiring();

        if (
            block.chainid == HYPEREVM_MAINNET_CHAIN_ID
                && (rewards.emissionStart() != 0
                    || token.balanceOf(address(rewards)) < TOTAL_EMISSION
                    || token.externalBuysEnabled()
                    || token.emergencyRescueAvailableAt() != 0
                    || token.emergencyRescueFingerprint() != bytes32(0)
                    || finalOwner.code.length == 0)
        ) revert InvalidWiring();

        emit NestModulesVerified(
            address(token), address(rewards), address(adapter), address(pool), address(plugin), address(locker)
        );
    }

    function _requireCode(address target) private view {
        if (target.code.length == 0) revert MissingCode(target);
    }
}
