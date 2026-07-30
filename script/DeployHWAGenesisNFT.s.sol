// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {HWAGenesisNFT} from "../src/hyperevm/HWAGenesisNFT.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmDeployHWAGenesisNFT {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envString(string calldata name) external returns (string memory value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys the optional first-party genesis collection; minting and freezing remain explicit owner actions.
contract DeployHWAGenesisNFT {
    VmDeployHWAGenesisNFT internal constant vm =
        VmDeployHWAGenesisNFT(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error MainnetNotConfirmed();
    error InvalidOwner();
    error InvalidMaxSupply();
    error VerificationFailed();

    event GenesisNFTDeployed(address indexed collection, address indexed finalOwner, uint256 maxSupply, string baseURI);

    function run() external returns (HWAGenesisNFT collection) {
        if (block.chainid != 998 && block.chainid != 999) revert WrongChain(block.chainid);
        if (!vm.envBool("HWA_GENESIS_NFT_DEPLOYMENT_CONFIRMED")) revert DeploymentNotConfirmed();
        if (block.chainid == 999 && !vm.envBool("MAINNET_DEPLOYMENT_CONFIRMED")) revert MainnetNotConfirmed();
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address finalOwner = vm.envAddress("FWA_OWNER");
        if (block.chainid == 999) {
            MainnetOwnerPolicy.validateDeploymentOwner(finalOwner, deployer, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED"));
        } else if (finalOwner == address(0)) {
            revert InvalidOwner();
        }
        uint256 maxSupply = vm.envUint("HWA_GENESIS_NFT_MAX_SUPPLY");
        if (block.chainid == 999 && maxSupply != 333) revert InvalidMaxSupply();
        string memory baseURI = vm.envString("HWA_GENESIS_NFT_BASE_URI");

        vm.startBroadcast(deployerKey);
        collection = new HWAGenesisNFT("HWA Genesis", "HWAG", baseURI, maxSupply, finalOwner);
        vm.stopBroadcast();

        if (
            collection.owner() != finalOwner || collection.maxSupply() != maxSupply || collection.currentSupply() != 0
                || keccak256(bytes(collection.baseURI())) != keccak256(bytes(baseURI))
        ) {
            revert VerificationFailed();
        }
        emit GenesisNFTDeployed(address(collection), finalOwner, maxSupply, baseURI);
    }
}
