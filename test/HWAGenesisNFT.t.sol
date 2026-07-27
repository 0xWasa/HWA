// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {HWAGenesisNFT} from "../src/hyperevm/HWAGenesisNFT.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {TestBase} from "./utils/TestBase.sol";

contract HWAGenesisNFTTest is TestBase {
    HWAGenesisNFT internal nft;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        nft = new HWAGenesisNFT("Hyper World Assets Genesis", "HWAG", "ipfs://genesis/", 200, address(this));
    }

    function testSequentialAirdropAndOneWaySnapshotFreeze() public {
        address[] memory recipients = new address[](2);
        recipients[0] = ALICE;
        recipients[1] = BOB;
        (uint256 first, uint256 last) = nft.batchMint(recipients);
        assertEq(first, 1);
        assertEq(last, 2);
        assertEq(nft.ownerOf(1), ALICE);
        nft.freezeSnapshot();
        assertTrue(nft.snapshotFrozen());

        vm.expectRevert(HWAGenesisNFT.MintingIsClosed.selector);
        nft.mint(ALICE);
        vm.expectRevert(HWAGenesisNFT.MetadataIsFrozen.selector);
        nft.setBaseURI("ipfs://changed/");
    }

    function testBaseURIIsObservableAndFreezesWithSnapshot() public {
        assertEq(keccak256(bytes(nft.baseURI())), keccak256(bytes("ipfs://genesis/")));
        nft.setBaseURI("https://assets.example/hwa/metadata/");
        assertEq(keccak256(bytes(nft.baseURI())), keccak256(bytes("https://assets.example/hwa/metadata/")));
        nft.mint(ALICE);
        assertEq(keccak256(bytes(nft.tokenURI(1))), keccak256(bytes("https://assets.example/hwa/metadata/1")));
        nft.freezeSnapshot();
        assertEq(keccak256(bytes(nft.baseURI())), keccak256(bytes("https://assets.example/hwa/metadata/")));
    }

    function testFrozenCollectionIsAValidSplitterSnapshot() public {
        nft.mint(ALICE);
        nft.mint(BOB);
        nft.freezeSnapshot();
        SplitterHyperEVM splitter = new SplitterHyperEVM(address(this), address(0x5EC0), address(nft), 2);
        assertEq(splitter.SNAPSHOT_SUPPLY(), 2);
        assertEq(splitter.MAX_TOKEN_ID(), 2);
    }

    function testOnlySafeOwnerCanMintOrFreeze() public {
        vm.prank(ALICE);
        vm.expectRevert(Ownable.Unauthorized.selector);
        nft.mint(ALICE);
        vm.prank(ALICE);
        vm.expectRevert(Ownable.Unauthorized.selector);
        nft.freezeSnapshot();
    }
}
