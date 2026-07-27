// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {GelatoVRFCoordinator} from "../src/hyperevm/GelatoVRFCoordinator.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {TestBase} from "./utils/TestBase.sol";

contract MockGelatoFWAConsumer {
    bool public shouldRevert;
    uint256 public callbackRequestId;
    uint256 public callbackWord;

    error ForcedCallbackFailure();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function request(GelatoVRFCoordinator coordinator) external returns (uint256 requestId) {
        requestId = coordinator.requestRandomWords(_request(true));
    }

    function requestInvalidPayment(GelatoVRFCoordinator coordinator) external returns (uint256 requestId) {
        requestId = coordinator.requestRandomWords(_request(false));
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (shouldRevert) revert ForcedCallbackFailure();
        callbackRequestId = requestId;
        callbackWord = randomWords[0];
    }

    function _request(bool nativePayment) internal pure returns (VRFV2PlusClient.RandomWordsRequest memory) {
        return VRFV2PlusClient.RandomWordsRequest({
            keyHash: keccak256("GELATO_VRF"),
            subId: 1,
            requestConfirmations: 3,
            callbackGasLimit: 900_000,
            numWords: 1,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
        });
    }
}

contract GelatoVRFCoordinatorTest is TestBase {
    address internal constant OPERATOR = address(0x6E1A70);
    address internal constant DEPOSITOR = address(0xA11CE);
    address internal constant PURCHASER = address(0xCAFE);

    GelatoVRFCoordinator internal coordinator;
    MockGelatoFWAConsumer internal consumer;

    function setUp() public {
        vm.warp(1_800_000_000);
        coordinator = new GelatoVRFCoordinator(OPERATOR, address(this));
        consumer = new MockGelatoFWAConsumer();
        coordinator.setConsumer(address(consumer));
        vm.deal(address(this), 10 ether);
    }

    function testRequestAndAuthenticatedFulfillment() public {
        uint256 requestId = consumer.request(coordinator);
        (
            ,,
            uint64 requestedAtBlock,
            uint32 callbackGasLimit,
            uint16 confirmations,
            GelatoVRFCoordinator.RequestStatus status
        ) = coordinator.requests(requestId);
        assertTrue(requestedAtBlock != 0);
        assertEq(callbackGasLimit, 900_000);
        assertEq(confirmations, 3);
        assertEq(uint256(status), uint256(GelatoVRFCoordinator.RequestStatus.Pending));
        assertTrue(coordinator.requestedHash(requestId) != bytes32(0));
        assertTrue(coordinator.pendingRequestExists(1));

        bytes memory payload = coordinator.requestPayload(requestId);
        vm.prank(OPERATOR);
        coordinator.fulfillRandomness(123456, payload);

        assertEq(consumer.callbackRequestId(), requestId);
        assertEq(consumer.callbackWord(), coordinator.fulfilledWord(requestId));
        assertTrue(consumer.callbackWord() != 123456);
        assertEq(coordinator.requestedHash(requestId), bytes32(0));
        assertFalse(coordinator.pendingRequestExists(1));
    }

    function testLegacyCoordinatorCannotDeployOnHyperEVMMainnet() public {
        vm.chainId(999);
        vm.expectRevert(GelatoVRFCoordinator.LegacyCoordinatorDisabledOnMainnet.selector);
        new GelatoVRFCoordinator(OPERATOR, address(this));
    }

    function testOnlyDedicatedOperatorCanFulfill() public {
        uint256 requestId = consumer.request(coordinator);
        bytes memory payload = coordinator.requestPayload(requestId);

        vm.expectRevert(GelatoVRFCoordinator.OnlyOperator.selector);
        coordinator.fulfillRandomness(7, payload);
    }

    function testTamperedPayloadAndReplayAreRejected() public {
        uint256 requestId = consumer.request(coordinator);
        bytes memory payload = coordinator.requestPayload(requestId);
        (uint256 round, bytes memory data) = abi.decode(payload, (uint256, bytes));
        bytes memory tampered = abi.encode(round + 1, data);

        vm.startPrank(OPERATOR);
        vm.expectRevert(GelatoVRFCoordinator.InvalidPayload.selector);
        coordinator.fulfillRandomness(8, tampered);
        coordinator.fulfillRandomness(8, payload);
        vm.expectRevert(GelatoVRFCoordinator.UnknownRequest.selector);
        coordinator.fulfillRandomness(8, payload);
        vm.stopPrank();
    }

    function testCallbackFailureRollsBackAndCanBeRetried() public {
        uint256 requestId = consumer.request(coordinator);
        bytes memory payload = coordinator.requestPayload(requestId);
        consumer.setShouldRevert(true);

        vm.prank(OPERATOR);
        vm.expectRevert(GelatoVRFCoordinator.ConsumerCallbackFailed.selector);
        coordinator.fulfillRandomness(9, payload);
        assertTrue(coordinator.pendingRequestExists(1));
        assertEq(coordinator.fulfilledWord(requestId), 0);

        consumer.setShouldRevert(false);
        vm.prank(OPERATOR);
        coordinator.fulfillRandomness(9, payload);
        assertFalse(coordinator.pendingRequestExists(1));
    }

    function testOnlyConsumerAndNativePaymentRequestsAreAccepted() public {
        VRFV2PlusClient.RandomWordsRequest memory request = VRFV2PlusClient.RandomWordsRequest({
            keyHash: keccak256("GELATO_VRF"),
            subId: 1,
            requestConfirmations: 3,
            callbackGasLimit: 900_000,
            numWords: 1,
            extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
        });
        vm.expectRevert(GelatoVRFCoordinator.OnlyConsumer.selector);
        coordinator.requestRandomWords(request);

        vm.expectRevert(GelatoVRFCoordinator.InvalidRequest.selector);
        consumer.requestInvalidPayment(coordinator);
    }

    function testSubscriptionCompatibilityAndWithdrawalGuard() public {
        coordinator.fundSubscriptionWithNative{value: 2 ether}(1);
        (, uint96 nativeBalance,, address subscriptionOwner, address[] memory consumers) =
            coordinator.getSubscription(1);
        assertEq(nativeBalance, 2 ether);
        assertEq(subscriptionOwner, address(this));
        assertEq(consumers.length, 1);
        assertEq(consumers[0], address(consumer));

        uint256 requestId = consumer.request(coordinator);
        vm.expectRevert(GelatoVRFCoordinator.PendingRequests.selector);
        coordinator.withdrawNative(address(this), 1 ether);

        bytes memory payload = coordinator.requestPayload(requestId);
        vm.prank(OPERATOR);
        coordinator.fulfillRandomness(10, payload);
        uint256 balanceBefore = address(this).balance;
        coordinator.withdrawNative(address(this), 1 ether);
        assertEq(address(this).balance, balanceBefore + 1 ether);
    }

    function testFuzzWordsAreDomainSeparated(uint256 gelatoRandomness) public {
        uint256 first = consumer.request(coordinator);
        uint256 second = consumer.request(coordinator);

        vm.startPrank(OPERATOR);
        coordinator.fulfillRandomness(gelatoRandomness, coordinator.requestPayload(first));
        uint256 firstWord = coordinator.fulfilledWord(first);
        coordinator.fulfillRandomness(gelatoRandomness, coordinator.requestPayload(second));
        vm.stopPrank();

        assertTrue(firstWord != coordinator.fulfilledWord(second));
    }

    receive() external payable {}
}

contract FWAGelatoVRFIntegrationTest is TestBase {
    address internal constant OPERATOR = address(0x6E1A70);
    address internal constant DEPOSITOR = address(0xA11CE);
    address internal constant PURCHASER = address(0xCAFE);

    GelatoVRFCoordinator internal coordinator;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.txGasPrice(0);
        coordinator = new GelatoVRFCoordinator(OPERATOR, address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(coordinator), 1, keccak256("GELATO_VRF"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();

        coordinator.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));
        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        vm.deal(DEPOSITOR, 100 ether);
        vm.deal(PURCHASER, 100 ether);
    }

    function testFWACompletesFullGameplayThroughGelatoCompatibilityCoordinator() public {
        nft.mint(DEPOSITOR, 1);
        vm.startPrank(DEPOSITOR);
        nft.approve(address(pool), 1);
        uint256 listingId = pool.listNFT{value: 10 ether}(address(nft), 1);
        vm.stopPrank();

        uint256 totalCost = pool.acquisitionFee() + pool.vrfServiceFee();
        vm.prank(PURCHASER);
        uint256 requestId = pool.acquire{value: totalCost}(0, 0);
        assertTrue(coordinator.pendingRequestExists(1));

        bytes memory payload = coordinator.requestPayload(requestId);
        vm.prank(OPERATOR);
        coordinator.fulfillRandomness(42, payload);

        (,,, uint256 selectedListing, FWA.AcquisitionStatus status) = pool.acquisitions(requestId);
        assertEq(selectedListing, listingId);
        assertEq(uint256(status), uint256(FWA.AcquisitionStatus.Fulfilled));

        vm.prank(PURCHASER);
        pool.keepNFT(listingId);
        assertEq(nft.ownerOf(1), PURCHASER);
    }
}
