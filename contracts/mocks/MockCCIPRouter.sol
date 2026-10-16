// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Client, IRouterClient, IAny2EVMMessageReceiver} from "../interfaces/ChainlinkCCIP.sol";

/// @dev Test double. Delivers messages synchronously to the destination receiver.
contract MockCCIPRouter is IRouterClient {
    uint256 public fee = 0.001 ether;
    uint256 public nonce;
    mapping(address => uint64) public selectorOf;

    event MessageRouted(bytes32 indexed messageId, uint64 indexed destSelector, address indexed receiver);

    function setFee(uint256 newFee) external {
        fee = newFee;
    }

    function setSelector(address who, uint64 selector) external {
        selectorOf[who] = selector;
    }

    function getFee(uint64, Client.EVM2AnyMessage memory) external view returns (uint256) {
        return fee;
    }

    function ccipSend(uint64 destSelector, Client.EVM2AnyMessage calldata message)
        external
        payable
        returns (bytes32 messageId)
    {
        require(msg.value >= fee, "MockCCIPRouter: fee");
        address receiver = abi.decode(message.receiver, (address));
        require(selectorOf[receiver] == destSelector, "MockCCIPRouter: no lane");

        messageId = keccak256(abi.encode(++nonce, msg.sender, destSelector));
        Client.Any2EVMMessage memory m = Client.Any2EVMMessage({
            messageId: messageId,
            sourceChainSelector: selectorOf[msg.sender],
            sender: abi.encode(msg.sender),
            data: message.data,
            destTokenAmounts: new Client.EVMTokenAmount[](0)
        });
        IAny2EVMMessageReceiver(receiver).ccipReceive(m);
        emit MessageRouted(messageId, destSelector, receiver);
    }
}
