// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ISafe, ISafeProxyFactory} from "../src/hyperevm/interfaces/ISafe.sol";

interface VmDeployHWASafe {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deterministically deploys the frozen HWA 2-of-3 Safe on HyperEVM mainnet.
/// @dev No module, guard, delegatecall or payment is enabled during setup. The canonical Safe
///      singleton, proxy factory and compatibility handler are independently registered for chain 999.
contract DeployHWASafe {
    VmDeployHWASafe internal constant vm = VmDeployHWASafe(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant MAINNET = 999;
    address internal constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address internal constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant SAFE_FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    uint256 internal constant SAFE_THRESHOLD = 2;
    uint256 internal constant SAFE_SALT_NONCE = uint256(keccak256("HWA_SAFE_HYPEREVM_MAINNET_V1"));
    address internal constant SENTINEL_MODULES = address(0x1);

    error WrongChain(uint256 actual);
    error DeploymentNotConfirmed();
    error InvalidSigner();
    error InvalidCanonicalDeployment();
    error AlreadyDeployed(address predicted);
    error UnexpectedSafe(address predicted, address deployed);
    error VerificationFailed();

    event HWASafeDeployed(
        address indexed safe,
        address indexed signer1,
        address indexed signer2,
        address signer3,
        uint256 threshold,
        uint256 saltNonce
    );

    function run() external returns (ISafe safe) {
        if (block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("HWA_SAFE_DEPLOYMENT_CONFIRMED")) revert DeploymentNotConfirmed();
        if (
            SAFE_SINGLETON.code.length == 0 || SAFE_PROXY_FACTORY.code.length == 0
                || SAFE_FALLBACK_HANDLER.code.length == 0
        ) revert InvalidCanonicalDeployment();

        address[] memory owners = _owners();
        bytes memory initializer = _initializer(owners);
        address predicted = predictSafe(initializer);
        if (predicted.code.length != 0) revert AlreadyDeployed(predicted);

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        address deployed =
            ISafeProxyFactory(SAFE_PROXY_FACTORY).createProxyWithNonce(SAFE_SINGLETON, initializer, SAFE_SALT_NONCE);
        vm.stopBroadcast();
        if (deployed != predicted) revert UnexpectedSafe(predicted, deployed);

        safe = ISafe(deployed);
        _verify(safe, owners);
        emit HWASafeDeployed(deployed, owners[0], owners[1], owners[2], SAFE_THRESHOLD, SAFE_SALT_NONCE);
    }

    function predictConfiguredSafe() external returns (address) {
        return predictSafe(_initializer(_owners()));
    }

    function predictSafe(bytes memory initializer) public view returns (address predicted) {
        bytes32 salt = keccak256(abi.encodePacked(keccak256(initializer), SAFE_SALT_NONCE));
        bytes memory deploymentData = abi.encodePacked(
            ISafeProxyFactory(SAFE_PROXY_FACTORY).proxyCreationCode(), uint256(uint160(SAFE_SINGLETON))
        );
        predicted = address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), SAFE_PROXY_FACTORY, salt, keccak256(deploymentData))))
            )
        );
    }

    function _owners() private returns (address[] memory owners) {
        owners = new address[](3);
        owners[0] = vm.envAddress("HWA_SAFE_SIGNER_1");
        owners[1] = vm.envAddress("HWA_SAFE_SIGNER_2");
        owners[2] = vm.envAddress("HWA_SAFE_SIGNER_3");
        if (
            owners[0] == address(0) || owners[1] == address(0) || owners[2] == address(0) || owners[0] == owners[1]
                || owners[0] == owners[2] || owners[1] == owners[2]
        ) revert InvalidSigner();
    }

    function _initializer(address[] memory owners) private pure returns (bytes memory) {
        return abi.encodeCall(
            ISafe.setup,
            (owners, SAFE_THRESHOLD, address(0), bytes(""), SAFE_FALLBACK_HANDLER, address(0), 0, payable(address(0)))
        );
    }

    function _verify(ISafe safe, address[] memory expectedOwners) private view {
        address[] memory actualOwners = safe.getOwners();
        (address[] memory modules, address next) = safe.getModulesPaginated(SENTINEL_MODULES, 10);
        if (
            actualOwners.length != 3 || safe.getThreshold() != SAFE_THRESHOLD
                || keccak256(bytes(safe.VERSION())) != keccak256(bytes("1.4.1")) || modules.length != 0
                || next != SENTINEL_MODULES
        ) revert VerificationFailed();
        for (uint256 i; i < expectedOwners.length; ++i) {
            if (!safe.isOwner(expectedOwners[i])) revert VerificationFailed();
        }
    }
}
