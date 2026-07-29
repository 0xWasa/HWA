// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {HWAGenesisNFT} from "../src/hyperevm/HWAGenesisNFT.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmFinalizeHWAGenesisEOA {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envString(string calldata name) external returns (string memory value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Mints the immutable 333-token Genesis snapshot to the explicitly accepted mainnet EOA.
/// @dev This is intentionally separate from deployment so the empty collection and hosted metadata
///      can be attested before four bounded mint transactions and the one-way freeze are broadcast.
contract FinalizeHWAGenesisEOA {
    VmFinalizeHWAGenesisEOA internal constant vm =
        VmFinalizeHWAGenesisEOA(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant MAINNET = 999;
    uint256 internal constant SUPPLY = 333;

    error WrongChain(uint256 actual);
    error FinalizationNotConfirmed();
    error InvalidGenesisState();

    event GenesisEOAFinalized(address indexed collection, address indexed owner, uint256 supply, string baseURI);

    function run() external {
        if (block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("HWA_GENESIS_NFT_FINALIZATION_CONFIRMED")) revert FinalizationNotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        address configuredOwner = vm.envAddress("FWA_OWNER");
        MainnetOwnerPolicy.validateDeploymentOwner(configuredOwner, owner, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED"));

        HWAGenesisNFT genesis = HWAGenesisNFT(vm.envAddress("FWA_SPLITTER_SNAPSHOT_NFT"));
        string memory expectedBaseURI = vm.envString("HWA_GENESIS_NFT_BASE_URI");
        if (
            address(genesis).code.length == 0 || genesis.owner() != owner || genesis.maxSupply() != SUPPLY
                || genesis.currentSupply() != 0 || genesis.snapshotFrozen()
                || keccak256(bytes(genesis.baseURI())) != keccak256(bytes(expectedBaseURI))
        ) revert InvalidGenesisState();

        vm.startBroadcast(ownerKey);
        _mintBatch(genesis, owner, 100);
        _mintBatch(genesis, owner, 100);
        _mintBatch(genesis, owner, 100);
        _mintBatch(genesis, owner, 33);
        genesis.freezeSnapshot();
        vm.stopBroadcast();

        if (
            genesis.currentSupply() != SUPPLY || genesis.highestMintedTokenId() != SUPPLY || !genesis.snapshotFrozen()
                || genesis.ownerOf(1) != owner || genesis.ownerOf(167) != owner || genesis.ownerOf(SUPPLY) != owner
                || keccak256(bytes(genesis.baseURI())) != keccak256(bytes(expectedBaseURI))
        ) revert InvalidGenesisState();

        emit GenesisEOAFinalized(address(genesis), owner, SUPPLY, expectedBaseURI);
    }

    function _mintBatch(HWAGenesisNFT genesis, address owner, uint256 length) private {
        address[] memory recipients = new address[](length);
        for (uint256 i; i < length; ++i) {
            recipients[i] = owner;
        }
        genesis.batchMint(recipients);
    }
}
