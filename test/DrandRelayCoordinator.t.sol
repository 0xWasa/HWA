// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";
import {TestBase} from "./utils/TestBase.sol";

contract MockDrandFWAConsumer {
    bool public shouldRevert;
    uint256 public callbackRequestId;
    uint256 public callbackWord;

    error ForcedCallbackFailure();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function request(DrandRelayCoordinator coordinator) external returns (uint256 requestId) {
        requestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keccak256("HYPEREVM_RANDOMNESS"),
                subId: 1,
                requestConfirmations: 3,
                callbackGasLimit: 900_000,
                numWords: 1,
                extraArgs: ""
            })
        );
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (shouldRevert) revert ForcedCallbackFailure();
        callbackRequestId = requestId;
        callbackWord = randomWords[0];
    }
}

contract DrandRelayCoordinatorTest is TestBase {
    address internal constant RELAYER = address(0xD12A4D);
    address internal constant SECOND_RELAYER = address(0xBEEF);

    DrandRelayCoordinator internal coordinator;
    MockDrandFWAConsumer internal consumer;

    function setUp() public {
        vm.warp(uint256(1_727_521_075) + 300);
        coordinator = new DrandRelayCoordinator(RELAYER, address(this), 6);
        consumer = new MockDrandFWAConsumer();
        coordinator.setConsumer(address(consumer));
        vm.deal(address(this), 10 ether);
    }

    function testRequestAndAuthenticatedFulfillment() public {
        uint256 requestId = consumer.request(coordinator);
        (uint64 round, DrandRelayCoordinator.RequestStatus status) = coordinator.requestState(requestId);
        assertEq(uint256(status), uint256(DrandRelayCoordinator.RequestStatus.Pending));
        assertTrue(coordinator.roundTimestamp(round) >= block.timestamp + 6);
        assertTrue(coordinator.pendingRequestExists(1));

        bytes memory signature = _signature(1);
        vm.warp(coordinator.roundTimestamp(round));
        vm.prank(RELAYER);
        coordinator.fulfillRandomness(requestId, round, signature);

        assertEq(consumer.callbackRequestId(), requestId);
        assertEq(consumer.callbackWord(), coordinator.fulfilledWord(requestId));
        assertEq(coordinator.fulfilledBeaconRandomness(requestId), sha256(signature));
        assertFalse(coordinator.pendingRequestExists(1));
    }

    function testLegacyCoordinatorCannotDeployOnHyperEVMMainnet() public {
        vm.chainId(999);
        vm.expectRevert(DrandRelayCoordinator.LegacyCoordinatorDisabledOnMainnet.selector);
        new DrandRelayCoordinator(RELAYER, address(this), 6);
    }

    function testRoundCalculationRoundsUpToFirstAvailableRound() public view {
        uint256 genesis = coordinator.DRAND_GENESIS_TIME();
        assertEq(coordinator.roundAtOrAfter(genesis), 1);
        assertEq(coordinator.roundAtOrAfter(genesis + 1), 2);
        assertEq(coordinator.roundAtOrAfter(genesis + 3), 2);
        assertEq(coordinator.roundAtOrAfter(genesis + 4), 3);
        assertEq(coordinator.roundTimestamp(3), genesis + 6);
    }

    function testCannotFulfillBeforeRoundTimestamp() public {
        uint256 requestId = consumer.request(coordinator);
        (uint64 round,) = coordinator.requestState(requestId);

        vm.prank(RELAYER);
        vm.expectRevert(DrandRelayCoordinator.RoundNotAvailable.selector);
        coordinator.fulfillRandomness(requestId, round, _signature(2));
    }

    function testOnlyAuthorizedRelayerCanFulfill() public {
        uint256 requestId = consumer.request(coordinator);
        (uint64 round,) = coordinator.requestState(requestId);
        vm.warp(coordinator.roundTimestamp(round));

        vm.expectRevert(DrandRelayCoordinator.OnlyRelayer.selector);
        coordinator.fulfillRandomness(requestId, round, _signature(3));
    }

    function testWrongRoundAndInvalidSignatureAreRejected() public {
        uint256 requestId = consumer.request(coordinator);
        (uint64 round,) = coordinator.requestState(requestId);
        vm.warp(coordinator.roundTimestamp(round + 1));

        vm.startPrank(RELAYER);
        vm.expectRevert(DrandRelayCoordinator.WrongRound.selector);
        coordinator.fulfillRandomness(requestId, round + 1, _signature(4));
        vm.expectRevert(DrandRelayCoordinator.InvalidSignatureLength.selector);
        coordinator.fulfillRandomness(requestId, round, hex"1234");
        vm.stopPrank();
    }

    function testDuplicateFulfillmentIsRejected() public {
        uint256 requestId = consumer.request(coordinator);
        (uint64 round,) = coordinator.requestState(requestId);
        bytes memory signature = _signature(5);
        vm.warp(coordinator.roundTimestamp(round));

        vm.startPrank(RELAYER);
        coordinator.fulfillRandomness(requestId, round, signature);
        vm.expectRevert(DrandRelayCoordinator.UnknownRequest.selector);
        coordinator.fulfillRandomness(requestId, round, signature);
        vm.stopPrank();
    }

    function testConsumerCallbackFailureCanBeRetried() public {
        uint256 requestId = consumer.request(coordinator);
        (uint64 round,) = coordinator.requestState(requestId);
        bytes memory signature = _signature(6);
        vm.warp(coordinator.roundTimestamp(round));
        consumer.setShouldRevert(true);

        vm.prank(RELAYER);
        vm.expectRevert(MockDrandFWAConsumer.ForcedCallbackFailure.selector);
        coordinator.fulfillRandomness(requestId, round, signature);
        assertTrue(coordinator.pendingRequestExists(1));
        assertEq(coordinator.fulfilledWord(requestId), 0);

        consumer.setShouldRevert(false);
        vm.prank(RELAYER);
        coordinator.fulfillRandomness(requestId, round, signature);
        assertFalse(coordinator.pendingRequestExists(1));
    }

    function testRequestsCanBeFulfilledOutOfOrder() public {
        uint256 first = consumer.request(coordinator);
        uint256 second = consumer.request(coordinator);
        (uint64 firstRound,) = coordinator.requestState(first);
        (uint64 secondRound,) = coordinator.requestState(second);
        vm.warp(coordinator.roundTimestamp(secondRound));

        vm.startPrank(RELAYER);
        coordinator.fulfillRandomness(second, secondRound, _signature(7));
        assertEq(coordinator.pendingRequestCount(), 1);
        coordinator.fulfillRandomness(first, firstRound, _signature(7));
        vm.stopPrank();

        assertEq(coordinator.pendingRequestCount(), 0);
        assertTrue(coordinator.fulfilledWord(first) != coordinator.fulfilledWord(second));
    }

    function testRelayerCanBeRotated() public {
        coordinator.setRelayer(SECOND_RELAYER, true);
        coordinator.setRelayer(RELAYER, false);
        uint256 requestId = consumer.request(coordinator);
        (uint64 round,) = coordinator.requestState(requestId);
        vm.warp(coordinator.roundTimestamp(round));

        vm.prank(RELAYER);
        vm.expectRevert(DrandRelayCoordinator.OnlyRelayer.selector);
        coordinator.fulfillRandomness(requestId, round, _signature(8));

        vm.prank(SECOND_RELAYER);
        coordinator.fulfillRandomness(requestId, round, _signature(8));
    }

    function testOnlyConsumerCanRequest() public {
        VRFV2PlusClient.RandomWordsRequest memory request = VRFV2PlusClient.RandomWordsRequest({
            keyHash: keccak256("HYPEREVM_RANDOMNESS"),
            subId: 1,
            requestConfirmations: 3,
            callbackGasLimit: 900_000,
            numWords: 1,
            extraArgs: ""
        });
        vm.expectRevert(DrandRelayCoordinator.OnlyConsumer.selector);
        coordinator.requestRandomWords(request);
    }

    function testSubscriptionCompatibilityAndWithdrawalGuard() public {
        coordinator.fundSubscriptionWithNative{value: 2 ether}(1);
        (, uint96 nativeBalance,, address owner, address[] memory consumers) = coordinator.getSubscription(1);
        assertEq(nativeBalance, 2 ether);
        assertEq(owner, address(this));
        assertEq(consumers.length, 1);
        assertEq(consumers[0], address(consumer));

        uint256 requestId = consumer.request(coordinator);
        vm.expectRevert(DrandRelayCoordinator.PendingRequests.selector);
        coordinator.withdrawNative(address(this), 1 ether);

        (uint64 round,) = coordinator.requestState(requestId);
        vm.warp(coordinator.roundTimestamp(round));
        vm.prank(RELAYER);
        coordinator.fulfillRandomness(requestId, round, _signature(9));

        uint256 balanceBefore = address(this).balance;
        coordinator.withdrawNative(address(this), 1 ether);
        assertEq(address(this).balance, balanceBefore + 1 ether);
    }

    function _signature(uint8 seed) internal pure returns (bytes memory signature) {
        signature = new bytes(64);
        for (uint256 i; i < 64; ++i) {
            signature[i] = bytes1(uint8(i) + seed);
        }
    }

    receive() external payable {}
}
