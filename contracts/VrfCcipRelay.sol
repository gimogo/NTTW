// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Client, IRouterClient, IAny2EVMMessageReceiver} from "./interfaces/ChainlinkCCIP.sol";
import {VRFV2PlusClient, IVRFCoordinatorV2Plus, IVRFConsumerV2Plus} from "./interfaces/ChainlinkVRF.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title VrfCcipRelay
 * @notice Deployed on the relay chain (Base). Turns an epoch-settlement request
 *         from the IMDRetroWall on Robinhood Chain into a Chainlink VRF v2.5
 *         random word, then sends that word back to the wall over CCIP.
 *
 *         Flow:
 *           1. The wall sends an epoch number by CCIP -> `ccipReceive`.
 *           2. The relay requests one random word from VRF (native ETH payment
 *              from its subscription).
 *           3. VRF calls `rawFulfillRandomWords` with the word.
 *           4. `deliver(epoch)` (or the retry inside `ccipReceive`) sends
 *              (epoch, randomWord) back to the wall over CCIP.
 *
 *         Trust model: the relay only forwards the VRF word. It does not choose
 *         or filter winners. The wall picks the winner from the word.
 *         The relay has no owner and no pause. Its subscription must be
 *         funded by someone (anyone can top it up on the VRF coordinator),
 *         and the relay's ETH balance must cover CCIP fees (anyone may send ETH
 *         to `receive`).
 */
contract VrfCcipRelay is IAny2EVMMessageReceiver, IVRFConsumerV2Plus {
    /// @notice Confirmations before VRF fulfills (Chainlink's minimum on Base is 0;
    ///         3 is used to reduce reorg exposure).
    uint16 public constant REQUEST_CONFIRMATIONS = 3;

    /// @notice Gas for `rawFulfillRandomWords` (one word).
    uint32 public constant CALLBACK_GAS_LIMIT = 200_000;

    /// @notice Gas limit for the CCIP message that executes `ccipReceive` on the wall.
    uint256 public constant CCIP_GAS_LIMIT = 300_000;

    IVRFCoordinatorV2Plus public immutable VRF_COORDINATOR;
    bytes32 public immutable KEY_HASH;
    uint256 public immutable SUBSCRIPTION_ID;

    IRouterClient public immutable CCIP_ROUTER;
    uint64 public immutable WALL_CHAIN_SELECTOR;
    address public immutable WALL;

    /// @notice VRF request id -> epoch that requested it (0 = unknown or already fulfilled).
    mapping(uint256 => uint256) private _epochOfRequest;

    /// @notice Epoch -> VRF word has arrived.
    mapping(uint256 => bool) public randomnessReady;

    /// @notice Epoch -> VRF word.
    mapping(uint256 => uint256) public randomnessOf;

    /// @notice Epoch -> word already sent to the wall.
    mapping(uint256 => bool) public delivered;

    event RandomnessRequested(uint256 indexed epoch, uint256 indexed requestId);
    event RandomnessReceived(uint256 indexed epoch, uint256 randomWord);
    event RandomnessDelivered(uint256 indexed epoch, bytes32 indexed messageId);

    error NotRouter(address caller);
    error NotCoordinator(address caller);
    error UnexpectedSourceChain(uint64 selector);
    error UnexpectedSender(address sender);
    error UnknownRequest(uint256 requestId);
    error NotReady(uint256 epoch);
    error InsufficientBalance(uint256 required, uint256 available);
    error ZeroAddress();

    constructor(
        address _vrfCoordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash,
        address _ccipRouter,
        uint64 _wallChainSelector,
        address _wall
    ) {
        if (_vrfCoordinator == address(0) || _ccipRouter == address(0) || _wall == address(0)) {
            revert ZeroAddress();
        }
        VRF_COORDINATOR = IVRFCoordinatorV2Plus(_vrfCoordinator);
        SUBSCRIPTION_ID = _subscriptionId;
        KEY_HASH = _keyHash;
        CCIP_ROUTER = IRouterClient(_ccipRouter);
        WALL_CHAIN_SELECTOR = _wallChainSelector;
        WALL = _wall;
    }

    /// @notice Accept ETH for CCIP fees.
    receive() external payable {}

    /// @notice IERC165. The CCIP offRamp checks this BEFORE calling `ccipReceive`:
    ///         if `supportsInterface(type(IAny2EVMMessageReceiver).interfaceId)`
    ///         reverts or returns false, data messages are silently treated as
    ///         token-only transfers (zero tokens = no-op) and the message is
    ///         still marked SUCCESS. Claiming the interface here is therefore
    ///         REQUIRED, not optional. Unknown ids return false (never revert),
    ///         and 0xffffffff stays false per ERC-165.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    /**
     * @notice CCIP entry point. Only the router may call, and only for messages
     *         from the wall on the wall chain.
     * @dev    If the word is already known, the result is sent immediately. This
     *         covers a settlement retry, so the wall does not wait for a new VRF request.
     */
    function ccipReceive(Client.Any2EVMMessage calldata message) external override {
        if (msg.sender != address(CCIP_ROUTER)) revert NotRouter(msg.sender);
        if (message.sourceChainSelector != WALL_CHAIN_SELECTOR) {
            revert UnexpectedSourceChain(message.sourceChainSelector);
        }
        address sender = abi.decode(message.sender, (address));
        if (sender != WALL) revert UnexpectedSender(sender);

        uint256 epoch = abi.decode(message.data, (uint256));

        if (randomnessReady[epoch]) {
            _deliver(epoch);
            return;
        }

        uint256 requestId = VRF_COORDINATOR.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: KEY_HASH,
                subId: SUBSCRIPTION_ID,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: CALLBACK_GAS_LIMIT,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: true})
                )
            })
        );
        _epochOfRequest[requestId] = epoch;
        emit RandomnessRequested(epoch, requestId);
    }

    /// @notice Called by the VRF coordinator with the random word.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external override {
        if (msg.sender != address(VRF_COORDINATOR)) revert NotCoordinator(msg.sender);
        uint256 epoch = _epochOfRequest[requestId];
        if (epoch == 0) revert UnknownRequest(requestId);
        delete _epochOfRequest[requestId];

        // Keep the first word for an epoch if a duplicate request ever returns.
        if (randomnessReady[epoch]) return;

        randomnessReady[epoch] = true;
        randomnessOf[epoch] = randomWords[0];
        emit RandomnessReceived(epoch, randomWords[0]);
    }

    /**
     * @notice Send the epoch's random word to the wall. Callable by anyone
     *         (e.g. to retry after a top-up). It is a no-op if already delivered.
     */
    function deliver(uint256 epoch) external returns (bytes32 messageId) {
        return _deliver(epoch);
    }

    function _deliver(uint256 epoch) private returns (bytes32 messageId) {
        if (!randomnessReady[epoch]) revert NotReady(epoch);
        if (delivered[epoch]) return bytes32(0);
        delivered[epoch] = true;

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(WALL),
            data: abi.encode(epoch, randomnessOf[epoch]),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            feeToken: address(0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV2({gasLimit: CCIP_GAS_LIMIT, allowOutOfOrderExecution: true})
            )
        });

        uint256 fee = CCIP_ROUTER.getFee(WALL_CHAIN_SELECTOR, message);
        if (address(this).balance < fee) revert InsufficientBalance(fee, address(this).balance);

        messageId = CCIP_ROUTER.ccipSend{value: fee}(WALL_CHAIN_SELECTOR, message);
        emit RandomnessDelivered(epoch, messageId);
    }
}
