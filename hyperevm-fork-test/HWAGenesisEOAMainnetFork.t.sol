// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {HWAGenesisNFT} from "../src/hyperevm/HWAGenesisNFT.sol";
import {TestBase} from "../test/utils/TestBase.sol";

/// @notice Exact dry-run of the irreversible Genesis mint/freeze sequence against mainnet state.
/// @dev Runs only inside a local HyperEVM fork. It never broadcasts transactions.
contract HWAGenesisEOAMainnetForkTest is TestBase {
    HWAGenesisNFT internal constant GENESIS =
        HWAGenesisNFT(0x89D52133B105E9548Df16dE4d7cf59c412daf191);
    address internal constant OWNER = 0x24398fc31899E2384E4E070fcdBF8Bb6D916FcD9;
    uint256 internal constant SUPPLY = 333;

    function testExactSingleOwnerMintAndFreezeSequence() public {
        assertEq(block.chainid, 999);
        assertTrue(address(GENESIS).code.length != 0);
        assertEq(GENESIS.owner(), OWNER);
        assertEq(GENESIS.maxSupply(), SUPPLY);
        assertEq(GENESIS.currentSupply(), 0);
        assertFalse(GENESIS.snapshotFrozen());

        vm.startPrank(OWNER);
        _mintBatch(100);
        assertEq(GENESIS.currentSupply(), 100);
        _mintBatch(100);
        assertEq(GENESIS.currentSupply(), 200);
        _mintBatch(100);
        assertEq(GENESIS.currentSupply(), 300);
        _mintBatch(33);
        assertEq(GENESIS.currentSupply(), SUPPLY);
        GENESIS.freezeSnapshot();
        vm.stopPrank();

        assertEq(GENESIS.highestMintedTokenId(), SUPPLY);
        assertTrue(GENESIS.snapshotFrozen());
        assertEq(GENESIS.ownerOf(1), OWNER);
        assertEq(GENESIS.ownerOf(167), OWNER);
        assertEq(GENESIS.ownerOf(SUPPLY), OWNER);
        assertEq(
            keccak256(bytes(GENESIS.baseURI())),
            keccak256(
                bytes(
                    "https://assets.hwa.fun/hwa-genesis/v3/96b80e5c8a06b07407d92b58dbf7865aab242439bdfdb5d8436e370cd2915648/metadata/"
                )
            )
        );
    }

    function _mintBatch(uint256 length) private {
        address[] memory recipients = new address[](length);
        for (uint256 i; i < length; ++i) {
            recipients[i] = OWNER;
        }
        GENESIS.batchMint(recipients);
    }
}
