// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity >=0.8.13 <0.9.0;

/// @notice Minimal forge-std-compatible configuration surface used by HWA invariant tests.
/// @dev Kept in the active test tree so CI never depends on the archived predecessor project.
abstract contract StdInvariant {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    address[] private _excludedContracts;
    address[] private _excludedSenders;
    address[] private _targetedContracts;
    address[] private _targetedSenders;
    string[] private _excludedArtifacts;
    string[] private _targetedArtifacts;
    FuzzArtifactSelector[] private _targetedArtifactSelectors;
    FuzzSelector[] private _excludedSelectors;
    FuzzSelector[] private _targetedSelectors;
    FuzzInterface[] private _targetedInterfaces;

    function excludeContract(address value) internal {
        _excludedContracts.push(value);
    }

    function excludeSelector(FuzzSelector memory value) internal {
        _excludedSelectors.push(value);
    }

    function excludeSender(address value) internal {
        _excludedSenders.push(value);
    }

    function excludeArtifact(string memory value) internal {
        _excludedArtifacts.push(value);
    }

    function targetArtifact(string memory value) internal {
        _targetedArtifacts.push(value);
    }

    function targetArtifactSelector(FuzzArtifactSelector memory value) internal {
        _targetedArtifactSelectors.push(value);
    }

    function targetContract(address value) internal {
        _targetedContracts.push(value);
    }

    function targetSelector(FuzzSelector memory value) internal {
        _targetedSelectors.push(value);
    }

    function targetSender(address value) internal {
        _targetedSenders.push(value);
    }

    function targetInterface(FuzzInterface memory value) internal {
        _targetedInterfaces.push(value);
    }

    function excludeArtifacts() public view returns (string[] memory) {
        return _excludedArtifacts;
    }

    function excludeContracts() public view returns (address[] memory) {
        return _excludedContracts;
    }

    function excludeSelectors() public view returns (FuzzSelector[] memory) {
        return _excludedSelectors;
    }

    function excludeSenders() public view returns (address[] memory) {
        return _excludedSenders;
    }

    function targetArtifacts() public view returns (string[] memory) {
        return _targetedArtifacts;
    }

    function targetArtifactSelectors() public view returns (FuzzArtifactSelector[] memory) {
        return _targetedArtifactSelectors;
    }

    function targetContracts() public view returns (address[] memory) {
        return _targetedContracts;
    }

    function targetSelectors() public view returns (FuzzSelector[] memory) {
        return _targetedSelectors;
    }

    function targetSenders() public view returns (address[] memory) {
        return _targetedSenders;
    }

    function targetInterfaces() public view returns (FuzzInterface[] memory) {
        return _targetedInterfaces;
    }
}
