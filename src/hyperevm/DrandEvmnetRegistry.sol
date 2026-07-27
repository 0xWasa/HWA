// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BLS} from "../vendor/randamu-bls/BLS.sol";

/// @title DrandEvmnetRegistry
/// @notice Permissionless on-chain verifier and cache for the public drand evmnet beacon.
/// @dev The BN254 verifier is vendored, unchanged apart from line endings, from Randamu's
///      archived commit 11af179a8287d978659aae07adb66aa60f64b8a6. That upstream code is
///      explicitly experimental and unaudited, so this registry remains in mandatory audit scope.
contract DrandEvmnetRegistry {
    bytes32 public constant DRAND_CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3;
    string public constant DST = "BLS_SIG_BN254G1_XMD:KECCAK-256_SVDW_RO_NUL_";

    mapping(uint64 round => bytes32 randomness) public roundRandomness;
    uint64 public latestProvenRound;

    event RoundProven(uint64 indexed round, bytes32 indexed randomness, bytes signature);

    error InvalidRound();
    error InvalidSignature();
    error RoundAlreadyProven();

    function publicKey() public pure returns (BLS.PointG2 memory) {
        return BLS.PointG2(
            [
                0x557ec32c2ad488e4d4f6008f89a346f18492092ccc0d594610de2732c8b808f,
                0x7e1d1d335df83fa98462005690372c643340060d205306a9aa8106b6bd0b382
            ],
            [
                0x297d3a4f9749b33eb2d904c9d9ebf17224150ddd7abd7567a9bec6c74480ee0b,
                0x95685ae3a85ba243747b1b2f426049010f6b73a0cf1d389351d5aaaa1047f6
            ]
        );
    }

    /// @notice Verifies one unchained evmnet beacon signature and caches SHA-256(signature).
    function proveRound(bytes calldata signature, uint64 round) external returns (bytes32 randomness) {
        if (round == 0) revert InvalidRound();
        if (roundRandomness[round] != bytes32(0)) revert RoundAlreadyProven();
        if (signature.length != 64) revert InvalidSignature();

        BLS.PointG1 memory signaturePoint = BLS.g1Unmarshal(signature);
        if (!BLS.isValidPointG1(signaturePoint)) revert InvalidSignature();

        BLS.PointG1 memory message = BLS.hashToPoint(bytes(DST), abi.encodePacked(keccak256(abi.encodePacked(round))));
        (bool pairingSuccess, bool callSuccess) = BLS.verifySingle(signaturePoint, publicKey(), message);
        if (!callSuccess || !pairingSuccess) revert InvalidSignature();

        randomness = sha256(signature);
        roundRandomness[round] = randomness;
        if (round > latestProvenRound) latestProvenRound = round;
        emit RoundProven(round, randomness, signature);
    }
}
