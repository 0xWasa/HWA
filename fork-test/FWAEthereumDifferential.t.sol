// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWARewards} from "fwa-rewards-reference/src/FWARewards.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAToken} from "fwa-rewards-reference/src/FWAToken.sol";
import {FWATokenHook} from "fwa-hook-reference/src/FWATokenHook.sol";
import {FWAClaim} from "fwa-claim-reference/src/FWAClaim.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";
import {Splitter} from "fwa-splitter-reference/src/Splitter.sol";

import {TestBase} from "../test/utils/TestBase.sol";

contract FWAEthereumDifferentialTest is TestBase {
    uint256 internal constant SNAPSHOT_BLOCK = 25_609_502;

    address internal constant FWA_ADDRESS = 0xB276F62DB0ce8CA2Ca5bc522695bE604521eAc1c;
    address internal constant REWARDS_ADDRESS = 0x6a1a1C0CfB3D3C538e13D36d608a5bcaa992fc78;
    address internal constant VRF_SERVICE_ADDRESS = 0xa084c33Fb7a467307452898b8D58165ebd2E5D9f;
    address internal constant TOKEN_ADDRESS = 0xa0Df17B5aC76ABaBA36E1450E2cbCd18A620C845;
    address internal constant HOOK_ADDRESS = 0x2C67ebA8A50AF0dB5Fba55F725247a75CbDA6444;
    address internal constant CLAIM_ADDRESS = 0xd4085d38855F17EdF0B1CCBFad7B3846fb305655;
    address internal constant WHITELIST_ADDRESS = 0x854352b275cF6A0DfFCf2983C986FBe9345e17c3;
    address internal constant SPLITTER_ADDRESS = 0x1C175b9F0e8C73eD3e677e1cBb1B5A2DD4373Bfe;
    address internal constant OWNER = 0x019817aD02a31B990433542097bE29D97613E8Cb;

    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 internal constant BEACON_SLOT =
        0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;

    FWA internal fwa = FWA(FWA_ADDRESS);

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
    }

    function testOfficialRuntimeCodeHashes() public view {
        assertEq(FWA_ADDRESS.codehash, 0xa53298a411a9ce5b5d352c45e3aaa90fac78632d21e7b928425cf6eb11ab8cc4);
        assertEq(REWARDS_ADDRESS.codehash, 0xf638c9e341efecf99bd093cff9b780bb3f7bf03bbd814b80c092d7e3361b4555);
        assertEq(VRF_SERVICE_ADDRESS.codehash, 0x8ab6e6d4ca28ade13f80314ccd54b3a648734ee88a5bcd807711fe5ae037f4a4);
        assertEq(TOKEN_ADDRESS.codehash, 0xd07b0280e4e25689956cff42290d843739714308e6fbe693017cede05c2c52fd);
        assertEq(HOOK_ADDRESS.codehash, 0x5eeafce23c30462750069d6313286eca9587da8ecffdff880288d31b75d41df0);
        assertEq(CLAIM_ADDRESS.codehash, 0x2bcc7652822828e6672fe46b9f2330ea71bad315f2df8e740605e0e0fff89f0d);
        assertEq(WHITELIST_ADDRESS.codehash, 0x0472057b43e7cc323bc058a785b861b2ee8d3c5956cd2de5b32e2af37447976a);
        assertEq(SPLITTER_ADDRESS.codehash, 0x10d57a933c83f60e2ff54eb1c7b64ab1c34278f34c4809ac6ae4e7e2accb2ce0);
    }

    function testCurrentCoreStateMatchesForensicSnapshot() public view {
        assertEq(fwa.owner(), OWNER);
        assertEq(fwa.activeListingCount(), 2_813);
        assertEq(fwa.topListingShareBps(), 100);
        assertEq(fwa.topThresholdBps(), 1_000);
        assertEq(fwa.selectionSlippageBps(), 1_000);
        assertEq(fwa.settlementDiscountBps(), 8_500);
        assertEq(fwa.settlementWindow(), 1 days);
        assertEq(fwa.finalizeWindow(), 7 days);
        assertEq(fwa.totalWeight(), 20_421_792_377_627_312_171_677);
        assertEq(fwa.treeRootWeight(), fwa.totalWeight());
        assertEq(fwa.weightedBackingTotal(), 2_812_999_999_999_999_999_513_454_282_361_996_610_763);
        assertEq(address(fwa.rewards()), REWARDS_ADDRESS);
        assertEq(address(fwa.token()), TOKEN_ADDRESS);
        assertEq(address(fwa.vrfService()), VRF_SERVICE_ADDRESS);
    }

    function testCurrentModuleWiringAndParameters() public view {
        FWARewards rewards = FWARewards(payable(REWARDS_ADDRESS));
        FWAVRFService vrf = FWAVRFService(payable(VRF_SERVICE_ADDRESS));
        FWAToken token = FWAToken(payable(TOKEN_ADDRESS));
        FWATokenHook hook = FWATokenHook(payable(HOOK_ADDRESS));
        FWAClaim claim = FWAClaim(CLAIM_ADDRESS);
        FWAWhitelist whitelist = FWAWhitelist(WHITELIST_ADDRESS);
        Splitter splitter = Splitter(payable(SPLITTER_ADDRESS));

        assertEq(rewards.fwa(), FWA_ADDRESS);
        assertEq(rewards.token(), TOKEN_ADDRESS);
        assertEq(address(vrf.fwa()), FWA_ADDRESS);
        assertEq(token.hook(), HOOK_ADDRESS);
        assertEq(token.pool(), REWARDS_ADDRESS);
        assertEq(hook.token(), TOKEN_ADDRESS);
        assertEq(claim.token(), TOKEN_ADDRESS);
        assertEq(whitelist.fwa(), FWA_ADDRESS);
        assertEq(whitelist.TTT_AMOUNT(), 0);
        assertEq(splitter.ownerShareBps(), 7_000);
        assertEq(splitter.nftShareBps(), 3_000);
    }

    function testDeploymentsAreDirectNotEip1967Proxies() public view {
        address[8] memory targets = [
            FWA_ADDRESS,
            REWARDS_ADDRESS,
            VRF_SERVICE_ADDRESS,
            TOKEN_ADDRESS,
            HOOK_ADDRESS,
            CLAIM_ADDRESS,
            WHITELIST_ADDRESS,
            SPLITTER_ADDRESS
        ];
        for (uint256 i = 0; i < targets.length; i++) {
            assertEq(vm.load(targets[i], IMPLEMENTATION_SLOT), bytes32(0));
            assertEq(vm.load(targets[i], ADMIN_SLOT), bytes32(0));
            assertEq(vm.load(targets[i], BEACON_SLOT), bytes32(0));
        }
    }

    function testVerifiedServiceRuntimeRecompilesExactly() public pure {
        assertEq(keccak256(type(FWAVRFService).runtimeCode), 0x8ab6e6d4ca28ade13f80314ccd54b3a648734ee88a5bcd807711fe5ae037f4a4);
    }
}
