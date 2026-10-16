// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal subset of the Chainlink CCIP v1.2 client library and router
// interface, copied from smartcontractkit/chainlink (contracts/src/v0.8/ccip).
// Kept local because the @chainlink/contracts npm package pulls in a git
// dependency that pnpm blocks in this repository.

library Client {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }

    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        EVMTokenAmount[] destTokenAmounts;
    }

    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        EVMTokenAmount[] tokenAmounts;
        address feeToken; // address(0) = pay fee in native gas token
        bytes extraArgs;
    }

    bytes4 internal constant EVM_EXTRA_ARGS_V2_TAG = 0x181dcf10;

    struct EVMExtraArgsV2 {
        uint256 gasLimit;
        bool allowOutOfOrderExecution;
    }

    function _argsToBytes(EVMExtraArgsV2 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EVM_EXTRA_ARGS_V2_TAG, extraArgs);
    }
}

interface IAny2EVMMessageReceiver {
    function ccipReceive(Client.Any2EVMMessage calldata message) external;
}

interface IRouterClient {
    function getFee(uint64 destinationChainSelector, Client.EVM2AnyMessage memory message)
        external
        view
        returns (uint256 fee);

    function ccipSend(uint64 destinationChainSelector, Client.EVM2AnyMessage calldata message)
        external
        payable
        returns (bytes32 messageId);
}
