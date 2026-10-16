// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFV2PlusClient, IVRFCoordinatorV2Plus, IVRFConsumerV2Plus} from "../interfaces/ChainlinkVRF.sol";

/// @dev Test double. Records requests; the test calls `fulfill` with a chosen word.
contract MockVRFCoordinator is IVRFCoordinatorV2Plus {
    uint256 public nextRequestId = 1;
    mapping(uint256 => address) public consumerOf;

    event RandomWordsRequested(uint256 indexed requestId, address indexed consumer, uint32 numWords);

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req)
        external
        override
        returns (uint256 requestId)
    {
        requestId = nextRequestId++;
        consumerOf[requestId] = msg.sender;
        emit RandomWordsRequested(requestId, msg.sender, req.numWords);
    }

    function fulfill(uint256 requestId, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        IVRFConsumerV2Plus(consumerOf[requestId]).rawFulfillRandomWords(requestId, words);
    }
}
