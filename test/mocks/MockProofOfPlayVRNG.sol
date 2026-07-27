// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IProofOfPlayVRNGCallback} from "../../src/hyperevm/interfaces/IProofOfPlayVRNG.sol";

contract MockProofOfPlayVRNG {
    uint256 public nextRequestId = 1;
    uint256 public lastRequestId;

    mapping(uint256 requestId => address requester) public requesterOf;
    mapping(uint256 requestId => uint256 traceId) public traceIdOf;

    event Requested(uint256 indexed requestId, address indexed requester, uint256 traceId);

    error UnknownRequest();

    function requestRandomNumberWithTraceId(uint256 traceId) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        lastRequestId = requestId;
        requesterOf[requestId] = msg.sender;
        traceIdOf[requestId] = traceId;
        emit Requested(requestId, msg.sender, traceId);
    }

    function fulfill(uint256 requestId, uint256 randomNumber) external {
        address requester = requesterOf[requestId];
        if (requester == address(0)) revert UnknownRequest();
        IProofOfPlayVRNGCallback(requester).randomNumberCallback(requestId, randomNumber);
    }
}

