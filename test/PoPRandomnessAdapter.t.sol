// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {MockProofOfPlayVRNG} from "./mocks/MockProofOfPlayVRNG.sol";
import {TestBase} from "./utils/TestBase.sol";

contract MockFWAConsumer {
    bool public shouldRevert;
    uint256 public callbackRequestId;
    uint256 public callbackWord;

    error ForcedCallbackFailure();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function request(PoPRandomnessAdapter adapter) external returns (uint256 requestId) {
        requestId = adapter.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keccak256("POP_VRNG"),
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

contract PoPRandomnessAdapterTest is TestBase {
    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal adapter;
    MockFWAConsumer internal consumer;

    function setUp() public {
        provider = new MockProofOfPlayVRNG();
        adapter = new PoPRandomnessAdapter(address(provider), address(this));
        consumer = new MockFWAConsumer();
        adapter.setConsumer(address(consumer));
    }

    function testRequestAndAuthenticatedFulfillment() public {
        uint256 localRequestId = consumer.request(adapter);
        uint256 providerRequestId = provider.lastRequestId();

        assertEq(localRequestId, 1);
        assertEq(provider.traceIdOf(providerRequestId), localRequestId);
        assertTrue(adapter.pendingRequestExists(1));

        provider.fulfill(providerRequestId, 12345);

        assertEq(consumer.callbackRequestId(), localRequestId);
        assertEq(consumer.callbackWord(), adapter.fulfilledWord(localRequestId));
        assertFalse(adapter.pendingRequestExists(1));
    }

    function testLegacyAdapterCannotDeployOnHyperEVMMainnet() public {
        vm.chainId(999);
        vm.expectRevert(PoPRandomnessAdapter.LegacyCoordinatorDisabledOnMainnet.selector);
        new PoPRandomnessAdapter(address(provider), address(this));
    }

    function testSameProviderWordIsDomainSeparatedPerRequest() public {
        uint256 first = consumer.request(adapter);
        uint256 firstProviderId = provider.lastRequestId();
        uint256 second = consumer.request(adapter);
        uint256 secondProviderId = provider.lastRequestId();

        provider.fulfill(firstProviderId, 777);
        provider.fulfill(secondProviderId, 777);

        assertTrue(adapter.fulfilledWord(first) != adapter.fulfilledWord(second));
    }

    function testUnauthorizedCallbackReverts() public {
        consumer.request(adapter);
        uint256 providerRequestId = provider.lastRequestId();
        vm.expectRevert(PoPRandomnessAdapter.OnlyProvider.selector);
        adapter.randomNumberCallback(providerRequestId, 1);
    }

    function testDuplicateCallbackReverts() public {
        consumer.request(adapter);
        uint256 providerRequestId = provider.lastRequestId();
        provider.fulfill(providerRequestId, 1);

        vm.expectRevert(PoPRandomnessAdapter.UnknownRequest.selector);
        provider.fulfill(providerRequestId, 1);
    }

    function testConsumerCallbackFailureCanBeRetried() public {
        uint256 localRequestId = consumer.request(adapter);
        uint256 providerRequestId = provider.lastRequestId();
        consumer.setShouldRevert(true);

        vm.expectRevert(MockFWAConsumer.ForcedCallbackFailure.selector);
        provider.fulfill(providerRequestId, 998);
        assertTrue(adapter.pendingRequestExists(1));
        assertEq(adapter.fulfilledWord(localRequestId), 0);

        consumer.setShouldRevert(false);
        provider.fulfill(providerRequestId, 998);
        assertFalse(adapter.pendingRequestExists(1));
        assertTrue(adapter.fulfilledWord(localRequestId) != 0);
    }

    function testOnlyConsumerCanRequest() public {
        VRFV2PlusClient.RandomWordsRequest memory request = VRFV2PlusClient.RandomWordsRequest({
            keyHash: keccak256("POP_VRNG"),
            subId: 1,
            requestConfirmations: 3,
            callbackGasLimit: 900_000,
            numWords: 1,
            extraArgs: ""
        });
        vm.expectRevert(PoPRandomnessAdapter.OnlyConsumer.selector);
        adapter.requestRandomWords(request);
    }

    function testSubscriptionCompatibilityAndWithdrawalGuard() public {
        adapter.fundSubscriptionWithNative{value: 2 ether}(1);
        (, uint96 nativeBalance,, address owner, address[] memory consumers) = adapter.getSubscription(1);
        assertEq(nativeBalance, 2 ether);
        assertEq(owner, address(this));
        assertEq(consumers.length, 1);
        assertEq(consumers[0], address(consumer));

        consumer.request(adapter);
        vm.expectRevert(PoPRandomnessAdapter.PendingRequests.selector);
        adapter.withdrawNative(address(this), 1 ether);

        provider.fulfill(provider.lastRequestId(), 42);
        uint256 balanceBefore = address(this).balance;
        adapter.withdrawNative(address(this), 1 ether);
        assertEq(address(this).balance, balanceBefore + 1 ether);
    }

    receive() external payable {}
}
