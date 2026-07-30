// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IFWAProcessAcquisitions {
    function processAcquisitions(uint256 maxCount) external returns (uint256 processed);
}

interface VmProcessHyperEVMAcquisitions {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Permissionless keeper helper that drains the canonical ready/expired acquisition prefix.
contract ProcessHyperEVMAcquisitions {
    VmProcessHyperEVMAcquisitions internal constant VM =
        VmProcessHyperEVMAcquisitions(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actual);
    error SubmissionNotConfirmed();
    error InvalidTarget();

    function run() external {
        if (block.chainid != 998 && block.chainid != 999) revert WrongChain(block.chainid);
        if (!VM.envBool("DRAND_PROOF_SUBMISSION_CONFIRMED")) revert SubmissionNotConfirmed();

        address fwaAddress = VM.envAddress("FWA_ADDRESS");
        uint256 maxCount = VM.envUint("FWA_ACQUISITION_PROCESS_BATCH");
        if (fwaAddress == address(0) || fwaAddress.code.length == 0 || maxCount == 0) revert InvalidTarget();

        uint256 privateKey = VM.envUint("FWA_DRAND_SUBMITTER_PRIVATE_KEY");
        VM.startBroadcast(privateKey);
        IFWAProcessAcquisitions(fwaAddress).processAcquisitions(maxCount);
        VM.stopBroadcast();
    }
}
