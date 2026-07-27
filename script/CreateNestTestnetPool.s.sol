// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {INestAlgebraFactory, INestAlgebraPool} from "../src/hyperevm/interfaces/INestAlgebra.sol";

interface VmNestTestnetPoolCreate {
    function envUint(string calldata name) external returns (uint256 value);
    function envBool(string calldata name) external returns (bool value);
    function envAddress(string calldata name) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Creates the uninitialized HWA/wHYPE pool in the non-official chain-998 harness.
contract CreateNestTestnetPool {
    VmNestTestnetPoolCreate internal constant vm =
        VmNestTestnetPoolCreate(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    event NestTestnetPoolCreated(address indexed factory, address indexed token, address indexed whype, address pool);

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error InvalidContract();
    error Unauthorized();
    error PoolAlreadyExists();
    error VerificationFailed();

    function run() external returns (address pool) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_NEST_TEST_STACK_CONFIRMED")) revert DeploymentNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address factoryAddress = vm.envAddress("NEST_FACTORY");
        address token = vm.envAddress("FWA_TOKEN_ADDRESS");
        address whype = vm.envAddress("NEST_WHYPE");
        if (factoryAddress.code.length == 0 || token.code.length == 0 || whype.code.length == 0) {
            revert InvalidContract();
        }

        INestAlgebraFactory factory = INestAlgebraFactory(factoryAddress);
        if (factory.owner() != deployer) revert Unauthorized();
        if (factory.poolByPair(token, whype) != address(0)) revert PoolAlreadyExists();

        vm.startBroadcast(deployerKey);
        pool = factory.createPool(token, whype);
        vm.stopBroadcast();

        INestAlgebraPool poolContract = INestAlgebraPool(pool);
        (uint160 price,,,,,) = poolContract.globalState();
        if (
            pool.code.length == 0 || factory.poolByPair(token, whype) != pool
                || poolContract.factory() != factoryAddress || price != 0
        ) revert VerificationFailed();

        emit NestTestnetPoolCreated(factoryAddress, token, whype, pool);
    }
}
