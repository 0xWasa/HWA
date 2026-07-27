// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";
import {PoPRandomnessAdapter} from "../src/hyperevm/PoPRandomnessAdapter.sol";
import {MockProofOfPlayVRNG} from "./mocks/MockProofOfPlayVRNG.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {TestBase} from "./utils/TestBase.sol";

contract FWADrandRelayIntegrationTest is TestBase {
    uint64 internal constant FIXTURE_ROUND = 19_159_982;
    address internal constant RELAYER = address(0xD12A4D);
    address internal constant DEPOSITOR = address(0xA11CE);
    address internal constant PURCHASER = address(0xCAFE);

    MockProofOfPlayVRNG internal provider;
    PoPRandomnessAdapter internal previousCoordinator;
    DrandRelayCoordinator internal drandCoordinator;
    FWAVRFService internal service;
    FWA internal pool;
    FWAWhitelist internal whitelist;
    MockERC721 internal nft;

    function setUp() public {
        vm.txGasPrice(0);
        provider = new MockProofOfPlayVRNG();
        previousCoordinator = new PoPRandomnessAdapter(address(provider), address(this));
        service = new FWAVRFService(1, 1);
        pool = new FWA(address(previousCoordinator), 1, keccak256("POP_VRNG"), 900_000, address(service));
        whitelist = new FWAWhitelist(address(pool), address(0), 0, address(this));
        nft = new MockERC721();
        drandCoordinator = new DrandRelayCoordinator(RELAYER, address(this), 6);

        previousCoordinator.setConsumer(address(pool));
        drandCoordinator.setConsumer(address(pool));
        service.setFWA(address(pool));
        service.setFeeConfig(1, 0, 2);
        pool.setAddr(FWAConfigKeys.WHITELIST_MANAGER, address(whitelist));

        address[] memory collections = new address[](1);
        collections[0] = address(nft);
        whitelist.setCollections(collections, true);

        vm.deal(DEPOSITOR, 100 ether);
        vm.deal(PURCHASER, 100 ether);
    }

    function testExistingFWACanMigrateAndCompleteGameplayWithPublicDrandFixture() public {
        pool.setAddr(FWAConfigKeys.VRF_COORDINATOR, address(drandCoordinator));
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);

        uint256 listingId = _list(1, 10 ether);
        uint256 fixtureTimestamp = drandCoordinator.roundTimestamp(FIXTURE_ROUND);
        vm.warp(fixtureTimestamp - drandCoordinator.MIN_ROUND_DELAY_SECONDS());
        uint256 requestId = _acquire();
        (uint64 targetRound,) = drandCoordinator.requestState(requestId);
        assertEq(targetRound, FIXTURE_ROUND);

        vm.warp(fixtureTimestamp);
        vm.prank(RELAYER);
        drandCoordinator.fulfillRandomness(requestId, FIXTURE_ROUND, _fixtureSignature());

        (uint256 selectedListing, FWA.AcquisitionStatus status) = _acquisitionResult(requestId);
        assertEq(selectedListing, listingId);
        assertEq(uint256(status), uint256(FWA.AcquisitionStatus.Fulfilled));
        assertEq(
            drandCoordinator.fulfilledBeaconRandomness(requestId),
            0x873fabe433099923de42fd10a2eee12d2c428bb1cdebafa5067a5816d4b91ff0
        );

        vm.prank(PURCHASER);
        pool.keepNFT(listingId);
        assertEq(nft.ownerOf(1), PURCHASER);
    }

    function testMigrationIsRejectedWhileOldCoordinatorRequestIsInFlight() public {
        pool.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);
        _list(1, 10 ether);
        _acquire();

        vm.expectRevert(FWA.AcquisitionStateLocked.selector);
        pool.setAddr(FWAConfigKeys.VRF_COORDINATOR, address(drandCoordinator));
    }

    function _list(uint256 tokenId, uint256 backing) internal returns (uint256 listingId) {
        nft.mint(DEPOSITOR, tokenId);
        vm.startPrank(DEPOSITOR);
        nft.approve(address(pool), tokenId);
        listingId = pool.listNFT{value: backing}(address(nft), tokenId);
        vm.stopPrank();
    }

    function _acquire() internal returns (uint256 requestId) {
        uint256 totalCost = pool.acquisitionFee() + pool.vrfServiceFee();
        vm.prank(PURCHASER);
        requestId = pool.acquire{value: totalCost}(0, 0);
    }

    function _acquisitionResult(uint256 requestId)
        internal
        view
        returns (uint256 listingId, FWA.AcquisitionStatus status)
    {
        (,,, listingId, status) = pool.acquisitions(requestId);
    }

    /// @dev Official drand evmnet response for round 19,159,982. Its SHA-256 digest is asserted above.
    function _fixtureSignature() internal pure returns (bytes memory) {
        return hex"07f4de90c6a898f165cecf60dfbdab91b342ca1e5b301053bbc088166e5b93a2160ddc206bc17811d47f318681c843ba71d54af8c8b2d226c24fa029202069a1";
    }
}
