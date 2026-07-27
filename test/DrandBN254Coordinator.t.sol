// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {DrandBN254Coordinator} from "../src/hyperevm/DrandBN254Coordinator.sol";
import {DrandEvmnetRegistry} from "../src/hyperevm/DrandEvmnetRegistry.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {TestBase} from "./utils/TestBase.sol";

contract MockDrandBN254Consumer {
    bool public shouldRevert;
    uint256 public callbackRequestId;
    uint256 public callbackWord;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function request(DrandBN254Coordinator coordinator) external returns (uint256 requestId) {
        requestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keccak256("DRAND_EVMNET_BN254"),
                subId: 1,
                requestConfirmations: 3,
                callbackGasLimit: 900_000,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
            })
        );
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (shouldRevert) revert("forced callback failure");
        callbackRequestId = requestId;
        callbackWord = randomWords[0];
    }
}

contract DrandBN254CoordinatorTest is TestBase {
    uint64 internal constant FIXTURE_ROUND = 19_159_982;
    uint64 internal constant EXPIRY_BLOCKS = 720;

    DrandEvmnetRegistry internal registry;
    DrandBN254Coordinator internal coordinator;
    MockDrandBN254Consumer internal consumer;

    function setUp() public {
        registry = new DrandEvmnetRegistry();
        coordinator = new DrandBN254Coordinator(address(registry), address(this), 30, EXPIRY_BLOCKS, 300, 1);
        consumer = new MockDrandBN254Consumer();
        coordinator.setConsumer(address(consumer));
        vm.deal(address(this), 10 ether);
        vm.warp(coordinator.roundTimestamp(FIXTURE_ROUND) - coordinator.MIN_ROUND_DELAY_SECONDS());
    }

    function testOfficialEvmnetFixtureIsVerifiedOnchain() public {
        bytes32 randomness = registry.proveRound(_fixtureSignature(), FIXTURE_ROUND);
        assertEq(randomness, 0x873fabe433099923de42fd10a2eee12d2c428bb1cdebafa5067a5816d4b91ff0);
        assertEq(registry.roundRandomness(FIXTURE_ROUND), randomness);
    }

    function testForgedSignatureCannotSelectAnOutcome() public {
        bytes memory forged = _fixtureSignature();
        forged[17] = bytes1(uint8(forged[17]) ^ 1);
        vm.expectRevert(DrandEvmnetRegistry.InvalidSignature.selector);
        registry.proveRound(forged, FIXTURE_ROUND);
    }

    function testOnCurveButWrongSignatureReachesPairingAndIsRejected() public {
        bytes memory onCurveWrongSignature = abi.encodePacked(uint256(1), uint256(2));
        vm.expectRevert(DrandEvmnetRegistry.InvalidSignature.selector);
        registry.proveRound(onCurveWrongSignature, FIXTURE_ROUND);
    }

    function testRequestRejectsRoundAlreadyPublicAtRequestTime() public {
        registry.proveRound(_fixtureSignature(), FIXTURE_ROUND);
        vm.expectRevert(DrandBN254Coordinator.TargetRoundAlreadyPublic.selector);
        consumer.request(coordinator);
    }

    function testConstructorRejectsDelayBelowThirtySeconds() public {
        vm.expectRevert(DrandBN254Coordinator.InvalidDelay.selector);
        new DrandBN254Coordinator(address(registry), address(this), 29, EXPIRY_BLOCKS, 300, 1);

        assertEq(coordinator.MIN_DELAY_SECONDS(), 30);
        assertEq(coordinator.MIN_ROUND_DELAY_SECONDS(), 30);
    }

    function testRequestUsesExplicitStartIdAndPermissionlessVerifiedFulfillment() public {
        uint256 requestId = consumer.request(coordinator);
        assertEq(requestId, coordinator.START_REQUEST_ID());
        (uint64 round, uint64 expiresAt, DrandBN254Coordinator.RequestStatus status) =
            coordinator.requestState(requestId);
        assertEq(round, FIXTURE_ROUND);
        assertEq(expiresAt, block.number + EXPIRY_BLOCKS);
        assertEq(uint256(status), uint256(DrandBN254Coordinator.RequestStatus.Pending));

        vm.warp(coordinator.roundTimestamp(round));
        vm.expectRevert(DrandBN254Coordinator.ConfirmationsPending.selector);
        coordinator.fulfillRandomness(requestId, round, _fixtureSignature());

        vm.roll(block.number + 3);
        vm.prank(address(0xBEEF));
        coordinator.fulfillRandomness(requestId, round, _fixtureSignature());

        assertEq(consumer.callbackRequestId(), requestId);
        assertEq(consumer.callbackWord(), coordinator.fulfilledWord(requestId));
        assertEq(coordinator.fulfilledBeaconRandomness(requestId), registry.roundRandomness(round));
        assertFalse(coordinator.pendingRequestExists(1));
    }

    function testCallbackFailureRollsBackProofAndCanBeRetried() public {
        uint256 requestId = consumer.request(coordinator);
        (uint64 round,,) = coordinator.requestState(requestId);
        vm.warp(coordinator.roundTimestamp(round));
        vm.roll(block.number + 3);
        consumer.setShouldRevert(true);

        vm.expectRevert(DrandBN254Coordinator.ConsumerCallbackFailed.selector);
        coordinator.fulfillRandomness(requestId, round, _fixtureSignature());
        assertEq(registry.roundRandomness(round), bytes32(0));
        assertTrue(coordinator.pendingRequestExists(1));

        consumer.setShouldRevert(false);
        coordinator.fulfillRandomness(requestId, round, _fixtureSignature());
        assertFalse(coordinator.pendingRequestExists(1));
    }

    function testAbandonedRequestExpiresPermissionlesslyAndUnlocksReserve() public {
        coordinator.fundSubscriptionWithNative{value: 2 ether}(1);
        uint256 requestId = consumer.request(coordinator);
        (, uint64 expiresAt,) = coordinator.requestState(requestId);

        vm.roll(expiresAt);
        vm.expectRevert(DrandBN254Coordinator.RequestNotExpired.selector);
        coordinator.expireRequest(requestId);

        vm.roll(expiresAt + 1);
        vm.prank(address(0xBEEF));
        coordinator.expireRequest(requestId);
        assertFalse(coordinator.pendingRequestExists(1));

        (uint64 round,, DrandBN254Coordinator.RequestStatus status) = coordinator.requestState(requestId);
        assertEq(uint256(status), uint256(DrandBN254Coordinator.RequestStatus.Expired));
        vm.warp(coordinator.roundTimestamp(round));
        vm.expectRevert(DrandBN254Coordinator.UnknownRequest.selector);
        coordinator.fulfillRandomness(requestId, round, _fixtureSignature());

        uint256 balanceBefore = address(this).balance;
        coordinator.withdrawNative(address(this), 2 ether);
        assertEq(address(this).balance, balanceBefore + 2 ether);
    }

    function testCachedRoundCanFulfillAnotherRequestWithoutTrustingSubmitterInput() public {
        uint256 first = consumer.request(coordinator);
        uint256 second = consumer.request(coordinator);
        (uint64 round,,) = coordinator.requestState(first);
        vm.warp(coordinator.roundTimestamp(round));
        vm.roll(block.number + 3);

        coordinator.fulfillRandomness(first, round, _fixtureSignature());
        coordinator.fulfillRandomness(second, round, bytes(""));
        assertTrue(coordinator.fulfilledWord(first) != coordinator.fulfilledWord(second));
    }

    function testForcedNativeSurplusRecoveryPreservesSubscriptionReserve() public {
        coordinator.fundSubscriptionWithNative{value: 2 ether}(1);
        vm.deal(address(coordinator), 3 ether);
        uint256 beforeBalance = address(this).balance;

        uint256 withdrawn = coordinator.withdrawForcedNativeSurplus(address(this));
        assertEq(withdrawn, 1 ether);
        assertEq(address(this).balance, beforeBalance + 1 ether);
        assertEq(coordinator.nativeSubscriptionBalance(), 2 ether);
        assertEq(address(coordinator).balance, 2 ether);
    }

    function _fixtureSignature() internal pure returns (bytes memory) {
        return hex"07f4de90c6a898f165cecf60dfbdab91b342ca1e5b301053bbc088166e5b93a2160ddc206bc17811d47f318681c843ba71d54af8c8b2d226c24fa029202069a1";
    }

    receive() external payable {}
}

contract FWADrandBN254IntegrationTest is TestBase {
    uint64 internal constant FIXTURE_ROUND = 19_159_982;
    address internal constant DEPOSITOR = address(0xA11CE);
    address internal constant PURCHASER = address(0xCAFE);

    DrandEvmnetRegistry internal registry;
    DrandBN254Coordinator internal coordinator;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;

    function setUp() public {
        vm.txGasPrice(0);
        registry = new DrandEvmnetRegistry();
        coordinator = new DrandBN254Coordinator(address(registry), address(this), 30, 720, 300, 1);
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(coordinator), 1, keccak256("DRAND_EVMNET_BN254"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();

        coordinator.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);
        pool.setUint(FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS, 360);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        vm.deal(DEPOSITOR, 100 ether);
        vm.deal(PURCHASER, 100 ether);
        vm.warp(coordinator.roundTimestamp(FIXTURE_ROUND) - coordinator.MIN_ROUND_DELAY_SECONDS());
    }

    function testFullFwaLifecycleUsesOnlyOnchainVerifiedBeacon() public {
        nft.mint(DEPOSITOR, 1);
        vm.startPrank(DEPOSITOR);
        nft.approve(address(pool), 1);
        uint256 listingId = pool.listNFT{value: 10 ether}(address(nft), 1);
        vm.stopPrank();

        uint256 totalCost = pool.acquisitionFee() + pool.vrfServiceFee();
        vm.prank(PURCHASER);
        uint256 requestId = pool.acquire{value: totalCost}(0, 0);
        (uint64 round,,) = coordinator.requestState(requestId);
        assertEq(round, FIXTURE_ROUND);

        vm.warp(coordinator.roundTimestamp(round));
        vm.roll(block.number + 3);
        vm.prank(address(0xD12A4D));
        coordinator.fulfillRandomness(requestId, round, _fixtureSignature());

        (,,, uint256 selectedListing, FWA.AcquisitionStatus status) = pool.acquisitions(requestId);
        assertEq(selectedListing, listingId);
        assertEq(uint256(status), uint256(FWA.AcquisitionStatus.Fulfilled));

        vm.prank(PURCHASER);
        pool.keepNFT(listingId);
        assertEq(nft.ownerOf(1), PURCHASER);
    }

    function _fixtureSignature() internal pure returns (bytes memory) {
        return hex"07f4de90c6a898f165cecf60dfbdab91b342ca1e5b301053bbc088166e5b93a2160ddc206bc17811d47f318681c843ba71d54af8c8b2d226c24fa029202069a1";
    }
}
