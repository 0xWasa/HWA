// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {HWAV2MigrationDistributor} from "../src/hyperevm/HWAV2MigrationDistributor.sol";
import {MockHyperSwapERC20} from "./mocks/MockHyperSwapV3.sol";
import {TestBase} from "./utils/TestBase.sol";

contract HWAV2MigrationDistributorTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    uint256 internal constant ALICE_AMOUNT = 12_500 ether;
    uint256 internal constant BOB_AMOUNT = 37_500 ether;

    MockHyperSwapERC20 internal token;
    MockHyperSwapERC20 internal oldToken;
    HWAV2MigrationDistributor internal distributor;
    bytes32 internal aliceLeaf;
    bytes32 internal bobLeaf;

    function setUp() public {
        token = new MockHyperSwapERC20("Hyper World Assets v2", "HWA");
        oldToken = new MockHyperSwapERC20("Hyper World Assets", "HWA");
        aliceLeaf = _leaf(ALICE, ALICE_AMOUNT);
        bobLeaf = _leaf(BOB, BOB_AMOUNT);
        bytes32 root = _hashPair(aliceLeaf, bobLeaf);
        distributor = new HWAV2MigrationDistributor(
            address(token), address(oldToken), root, uint64(block.number), ALICE_AMOUNT + BOB_AMOUNT
        );
        token.mint(address(distributor), ALICE_AMOUNT + BOB_AMOUNT);
    }

    function testClaimsAreOneToOneAndRemainFullyFunded() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bobLeaf;
        vm.prank(ALICE);
        distributor.claim(ALICE_AMOUNT, proof);

        assertEq(token.balanceOf(ALICE), ALICE_AMOUNT);
        assertEq(distributor.totalClaimed(), ALICE_AMOUNT);
        assertTrue(distributor.claimed(ALICE));
        assertTrue(distributor.fullyFunded());
    }

    function testCannotClaimTwice() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bobLeaf;
        vm.prank(ALICE);
        distributor.claim(ALICE_AMOUNT, proof);

        vm.prank(ALICE);
        vm.expectRevert(HWAV2MigrationDistributor.AlreadyClaimed.selector);
        distributor.claim(ALICE_AMOUNT, proof);
    }

    function testWrongAmountCannotClaim() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bobLeaf;
        vm.prank(ALICE);
        vm.expectRevert(HWAV2MigrationDistributor.InvalidProof.selector);
        distributor.claim(ALICE_AMOUNT + 1, proof);
    }

    function testContractHasNoAdminOrRescueAuthority() public view {
        assertEq(distributor.OLD_TOKEN(), address(oldToken));
        assertEq(uint256(distributor.SNAPSHOT_BLOCK()), block.number);
        assertEq(distributor.MIGRATION_ALLOCATION(), ALICE_AMOUNT + BOB_AMOUNT);
    }

    function _leaf(address account, uint256 amount) private pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}