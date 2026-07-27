// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function roll(uint256 newHeight) external;
    function warp(uint256 newTimestamp) external;
    function txGasPrice(uint256 newGasPrice) external;
    function chainId(uint256 newChainId) external;
    function envOr(string calldata name, string calldata defaultValue) external returns (string memory value);
    function setEnv(string calldata name, string calldata value) external;
    function createSelectFork(string calldata urlOrAlias, uint256 blockNumber) external returns (uint256 forkId);
    function load(address target, bytes32 slot) external view returns (bytes32 data);
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    error AssertionFailed();
    error AssertionEqUint(uint256 left, uint256 right);
    error AssertionEqAddress(address left, address right);
    error AssertionEqBytes32(bytes32 left, bytes32 right);

    function assertTrue(bool condition) internal pure {
        if (!condition) revert AssertionFailed();
    }

    function assertFalse(bool condition) internal pure {
        if (condition) revert AssertionFailed();
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        if (left != right) revert AssertionEqUint(left, right);
    }

    function assertEq(address left, address right) internal pure {
        if (left != right) revert AssertionEqAddress(left, right);
    }

    function assertEq(bytes32 left, bytes32 right) internal pure {
        if (left != right) revert AssertionEqBytes32(left, right);
    }

    function bound(uint256 value, uint256 minimum, uint256 maximum) internal pure returns (uint256) {
        if (minimum > maximum) revert AssertionFailed();
        if (value >= minimum && value <= maximum) return value;
        return minimum + (value % (maximum - minimum + 1));
    }
}
