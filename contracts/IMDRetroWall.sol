// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Client, IRouterClient} from "./interfaces/ChainlinkCCIP.sol";
import {IAny2EVMMessageReceiver} from "./interfaces/ChainlinkCCIP.sol";

/**
 * @title IMDRetroWall (v3)
 * @notice Immutable, ownerless sticky-note wall. Every stamped note is an
 *         ERC-721 on this chain. Each stamp is also one lottery ticket in its
 *         epoch, and each epoch's prize pool goes to ONE winner drawn at random.
 *
 *         Economics per stamp (ERC-20 `PAYMENT_TOKEN`, 1000 tokens total):
 *           - 500 tokens are sent to the dead address (burned) immediately.
 *           - 500 tokens are kept in this contract as the epoch prize pool.
 *           - The stamp adds one ticket to the epoch's ticket list.
 *           - Each address may stamp at most MAX_STAMPS_PER_EPOCH per epoch.
 *
 *         Settlement (per 7-day epoch, once the epoch has ended):
 *           1. Anyone calls `requestSettlement(epoch)` and pays the CCIP fee.
 *           2. This contract sends a CCIP message to the relay on Base
 *              (`VrfCcipRelay`), which asks Chainlink VRF v2.5 for a random word.
 *           3. The relay sends the random word back by CCIP.
 *              `ccipReceive` picks the winner as `tickets[word % ticketCount]`
 *              and credits the whole prize pool to `claimable[winner]`.
 *           4. The winner pulls the reward with `claimReward()`.
 *           An epoch with no tickets settles with no payout.
 *
 *         Trust model (read before relying on the prize):
 *           - Randomness comes from Chainlink VRF on Base, not from this chain.
 *             The relay on Base is trusted to forward the VRF word unchanged.
 *           - Only the CCIP router may call `ccipReceive`, and only messages
 *             from the configured relay on the configured lane are accepted.
 *           - The relay address is set once by the deployer (`setRelay`),
 *             then the contract has no admin. Nothing can be paused or
 *             upgraded.
 *           - A winner is paid only if the stamp was recorded in the epoch.
 *             Stamps are never removed.
 *
 *         Known limitations:
 *           - Sybil addresses can buy more tickets, but only up to the per-
 *             address cap per epoch. Each stamp costs 1000 tokens, so buying
 *             more tickets means spending more.
 *           - Tokens sent to this contract directly (not via `stampNote`) are
 *             not tracked and cannot be recovered.
 *           - If the relay on Base is misconfigured or the CCIP lane stops
 *             working, a settlement can be retried after SETTLEMENT_RETRY_DELAY.
 */
contract IMDRetroWall is ERC721, ERC721Enumerable, IAny2EVMMessageReceiver {
    using Strings for uint256;
    using SafeERC20 for IERC20;

    /// @dev Both ERC721 and ERC721Enumerable define `supportsInterface`.
    /// @dev This must also claim the CCIP receiver interface: the CCIP offRamp
    ///      only calls `ccipReceive` when the receiver advertises it via
    ///      ERC-165. Without this, incoming settlement messages are silently
    ///      treated as token-only transfers (zero tokens = no-op) while the
    ///      message is still marked SUCCESS, and settlements never complete.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId
            || super.supportsInterface(interfaceId);
    }

    /// @dev Both ERC721 and ERC721Enumerable hook `_update`.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    /// @dev Required by ERC721Enumerable.
    function _increaseBalance(address account, uint128 value)
        internal
        virtual
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    // ---------------------------------------------------------------------
    // Note validation constants
    // ---------------------------------------------------------------------

    /// @notice Maximum note content length, in bytes (UTF-8).
    uint256 public constant MAX_CONTENT_BYTES = 280;

    /// @notice Minimum tilt allowed for a note (degrees).
    int8 public constant MIN_ROTATION = -15;

    /// @notice Maximum tilt allowed for a note (degrees).
    int8 public constant MAX_ROTATION = 15;

    /// @notice Maximum X/Y coordinate (uint16 space).
    uint16 public constant MAX_POSITION = type(uint16).max;

    // ---------------------------------------------------------------------
    // Payment constants
    // ---------------------------------------------------------------------

    /// @notice ERC-20 charged per stamp. Set once in the constructor.
    IERC20 public immutable PAYMENT_TOKEN;

    /// @notice Total token fee per stamp (1000 tokens, 18 decimals).
    uint256 public constant TOKEN_FEE = 1000e18;

    /// @notice Half of TOKEN_FEE is burned on each stamp.
    uint256 public constant TOKEN_FEE_BURN_SHARE = TOKEN_FEE / 2; // 500e18

    /// @notice The other half of TOKEN_FEE is kept as the epoch prize pool.
    uint256 public constant TOKEN_FEE_POOL_SHARE = TOKEN_FEE - TOKEN_FEE_BURN_SHARE; // 500e18

    /// @notice Burn (dead) address.
    address public constant TOKEN_BURN = 0x000000000000000000000000000000000000dEaD;

    // ---------------------------------------------------------------------
    // Epoch and randomness constants
    // ---------------------------------------------------------------------

    /// @notice One epoch lasts exactly 7 days.
    uint256 public constant EPOCH_DURATION = 7 days;

    /// @notice Maximum stamps one address may make per epoch.
    uint256 public constant MAX_STAMPS_PER_EPOCH = 5;

    /// @notice A pending settlement may be re-requested after this delay
    ///         (covers a lost or stalled CCIP message).
    uint256 public constant SETTLEMENT_RETRY_DELAY = 1 days;

    /// @notice Gas limit for the CCIP message that executes `ccipReceive`
    ///         on this contract.
    uint256 public constant CCIP_GAS_LIMIT = 300_000;

    /// @notice CCIP chain selector of the relay chain (Base mainnet).
    uint64 public immutable RELAY_CHAIN_SELECTOR;

    /// @notice Chainlink CCIP router on this chain (Robinhood Chain).
    IRouterClient public immutable CCIP_ROUTER;

    /// @notice Relay contract on the relay chain (set once by the deployer).
    address public relay;

    /// @notice Deployer allowed to call `setRelay` once.
    address public immutable DEPLOYER;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Note {
        uint256 id;
        address author;
        string content; // max 280 bytes, valid UTF-8
        string color; // "#RRGGBB" hex string
        uint16 posX; // 0..65535 virtual canvas X
        uint16 posY; // 0..65535 virtual canvas Y
        int8 rotation; // -15..15 degrees
        uint256 timestamp;
    }

    enum SettlementStatus {
        None,
        Requested,
        Settled
    }

    /// @notice Append-only wall of notes. Note id == tokenId.
    Note[] public allNotes;

    /// @notice Start of epoch 1. Epoch k runs from genesis + (k-1) * EPOCH_DURATION.
    uint256 public immutable GENESIS;

    /// @notice Stamps made by an address in an epoch.
    mapping(uint256 => mapping(address => uint256)) public stampsInEpoch;

    /// @notice Ticket list for an epoch. One entry per stamp, so an address
    ///         appears once per stamp it made. Winner = tickets[random % length].
    mapping(uint256 => address[]) private _tickets;

    /// @notice Prize pool for an epoch (500 tokens per stamp).
    mapping(uint256 => uint256) public epochPrize;

    /// @notice Settlement state per epoch.
    mapping(uint256 => SettlementStatus) public settlementStatus;

    /// @notice Timestamp of the latest settlement request for an epoch.
    mapping(uint256 => uint256) public settlementRequestedAt;

    /// @notice Winnings credited to an address, withdrawn with `claimReward`.
    mapping(address => uint256) public claimable;

    /// @notice Sum of all `claimable` balances.
    uint256 public totalClaimable;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted on every successful stamp.
    event NoteCreated(
        uint256 indexed id,
        address indexed author,
        string content,
        string color,
        uint16 posX,
        uint16 posY,
        int8 rotation,
        uint256 timestamp
    );

    /// @notice Emitted when the relay address is set (once).
    event RelaySet(address indexed relay);

    /// @notice Emitted when a settlement is sent to the relay.
    event SettlementRequested(uint256 indexed epoch, bytes32 indexed messageId, address indexed caller);

    /// @notice Emitted when a winner is drawn. `winner` is address(0) and
    ///         `prize` is 0 for an epoch with no tickets.
    event WinnerDrawn(uint256 indexed epoch, address indexed winner, uint256 prize, uint256 randomWord);

    /// @notice Emitted when a winner withdraws.
    event RewardClaimed(address indexed account, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error EmptyPaymentToken();
    error InvalidTokenDecimals(uint8 decimals);
    error ZeroAddress();

    error EmptyContent();
    error ContentTooLong(uint256 length);
    error InvalidUtf8();
    error InvalidColor(string color);
    error InvalidRotation(int8 rotation);
    error StampLimitReached(uint256 limit);
    error NoteNotFound(uint256 id);
    error TokenTransferFailed();

    error EpochNotEnded(uint256 epoch);
    error EpochAlreadySettled(uint256 epoch);
    error SettlementPending(uint256 epoch, uint256 retryAt);
    error InsufficientFee(uint256 required, uint256 provided);
    error RelayNotSet();
    error RelayAlreadySet();
    error NotDeployer();
    error NotRouter(address caller);
    error UnexpectedSourceChain(uint64 selector);
    error UnexpectedSender(address sender);
    error RefundFailed();
    error NothingToClaim();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @param _paymentToken       ERC-20 charged per stamp (18 decimals).
     * @param _ccipRouter         Chainlink CCIP router on this chain.
     * @param _relayChainSelector CCIP chain selector of the relay chain (Base).
     */
    constructor(
        IERC20 _paymentToken,
        address _ccipRouter,
        uint64 _relayChainSelector
    ) ERC721("IMD Retro Wall Note", "IMDNOTE") {
        if (address(_paymentToken) == address(0)) revert EmptyPaymentToken();
        if (_ccipRouter == address(0)) revert ZeroAddress();

        uint8 decimals = IERC20Metadata(address(_paymentToken)).decimals();
        if (decimals != 18) revert InvalidTokenDecimals(decimals);

        PAYMENT_TOKEN = _paymentToken;
        CCIP_ROUTER = IRouterClient(_ccipRouter);
        RELAY_CHAIN_SELECTOR = _relayChainSelector;
        DEPLOYER = msg.sender;
        GENESIS = block.timestamp;
    }

    /**
     * @notice Set the relay address on the relay chain. One time only.
     * @dev    Deployer-only. After this call there is no admin.
     */
    function setRelay(address _relay) external {
        if (msg.sender != DEPLOYER) revert NotDeployer();
        if (relay != address(0)) revert RelayAlreadySet();
        if (_relay == address(0)) revert ZeroAddress();
        relay = _relay;
        emit RelaySet(_relay);
    }

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /**
     * @notice Stamp a note permanently on the wall and mint its NFT.
     *         Each stamp is one ticket in the current epoch's lottery.
     *         Payment is token-only and atomic: 500 tokens are burned and
     *         500 are kept in the prize pool. Requires a prior ERC-20
     *         `approve` of at least TOKEN_FEE.
     * @param _content  Note text, 1..280 bytes of valid UTF-8.
     * @param _color    Hex color, exactly "#RRGGBB".
     * @param _posX     X coordinate on the 65535-wide virtual canvas.
     * @param _posY     Y coordinate on the 65535-tall virtual canvas.
     * @param _rotation Tilt in degrees, -15..15.
     * @return id       Id of the new note (also its tokenId).
     */
    function stampNote(
        string calldata _content,
        string calldata _color,
        uint16 _posX,
        uint16 _posY,
        int8 _rotation
    ) external returns (uint256 id) {
        // --- Checks ---
        uint256 len = bytes(_content).length;
        if (len == 0) revert EmptyContent();
        if (len > MAX_CONTENT_BYTES) revert ContentTooLong(len);
        if (!_isValidUtf8(bytes(_content))) revert InvalidUtf8();
        if (!_isValidHexColor(_color)) revert InvalidColor(_color);
        if (_rotation < MIN_ROTATION || _rotation > MAX_ROTATION) {
            revert InvalidRotation(_rotation);
        }
        uint256 epoch = currentEpoch();
        uint256 newCount = stampsInEpoch[epoch][msg.sender] + 1;
        if (newCount > MAX_STAMPS_PER_EPOCH) revert StampLimitReached(MAX_STAMPS_PER_EPOCH);

        // --- Effects ---
        id = allNotes.length;
        uint256 ts = block.timestamp;
        allNotes.push(Note(id, msg.sender, _content, _color, _posX, _posY, _rotation, ts));

        stampsInEpoch[epoch][msg.sender] = newCount;
        _tickets[epoch].push(msg.sender);
        epochPrize[epoch] += TOKEN_FEE_POOL_SHARE;

        emit NoteCreated(id, msg.sender, _content, _color, _posX, _posY, _rotation, ts);

        // --- Interactions ---
        PAYMENT_TOKEN.safeTransferFrom(msg.sender, TOKEN_BURN, TOKEN_FEE_BURN_SHARE);
        PAYMENT_TOKEN.safeTransferFrom(msg.sender, address(this), TOKEN_FEE_POOL_SHARE);

        _safeMint(msg.sender, id);
    }

    /**
     * @notice Ask the relay for a random word for an ended epoch and draw its
     *         winner when the word arrives. Callable by anyone, and the caller
     *         pays the CCIP fee. Excess native value is refunded.
     * @dev    Epoch 0 and the current/future epochs are rejected. A pending
     *         request may be re-sent after SETTLEMENT_RETRY_DELAY. A settled
     *         epoch cannot be requested again.
     */
    function requestSettlement(uint256 epoch) external payable returns (bytes32 messageId) {
        if (relay == address(0)) revert RelayNotSet();
        if (epoch == 0 || epoch >= currentEpoch()) revert EpochNotEnded(epoch);

        SettlementStatus status = settlementStatus[epoch];
        if (status == SettlementStatus.Settled) revert EpochAlreadySettled(epoch);
        if (status == SettlementStatus.Requested) {
            uint256 retryAt = settlementRequestedAt[epoch] + SETTLEMENT_RETRY_DELAY;
            if (block.timestamp < retryAt) revert SettlementPending(epoch, retryAt);
        }

        // Epoch with no tickets: nothing to draw, settle without a relay call.
        if (_tickets[epoch].length == 0) {
            settlementStatus[epoch] = SettlementStatus.Settled;
            emit WinnerDrawn(epoch, address(0), 0, 0);
            _refundExcess(msg.value, 0);
            return bytes32(0);
        }

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(relay),
            data: abi.encode(epoch),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            feeToken: address(0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV2({gasLimit: CCIP_GAS_LIMIT, allowOutOfOrderExecution: true})
            )
        });

        uint256 fee = CCIP_ROUTER.getFee(RELAY_CHAIN_SELECTOR, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        settlementStatus[epoch] = SettlementStatus.Requested;
        settlementRequestedAt[epoch] = block.timestamp;

        messageId = CCIP_ROUTER.ccipSend{value: fee}(RELAY_CHAIN_SELECTOR, message);
        emit SettlementRequested(epoch, messageId, msg.sender);

        _refundExcess(msg.value, fee);
    }

    /**
     * @notice CCIP entry point. Accepts a random word from the relay and draws
     *         the winner for the epoch in the message.
     * @dev    Callable only by the CCIP router, and only for messages from the
     *         relay on the relay chain. The winner is picked as
     *         tickets[randomWord % ticketCount].
     */
    function ccipReceive(Client.Any2EVMMessage calldata message) external override {
        if (msg.sender != address(CCIP_ROUTER)) revert NotRouter(msg.sender);
        if (message.sourceChainSelector != RELAY_CHAIN_SELECTOR) {
            revert UnexpectedSourceChain(message.sourceChainSelector);
        }
        address sender = abi.decode(message.sender, (address));
        if (sender == address(0) || sender != relay) revert UnexpectedSender(sender);

        (uint256 epoch, uint256 randomWord) = abi.decode(message.data, (uint256, uint256));
        if (settlementStatus[epoch] == SettlementStatus.Settled) revert EpochAlreadySettled(epoch);

        address[] storage tickets = _tickets[epoch];
        uint256 prize = epochPrize[epoch];
        settlementStatus[epoch] = SettlementStatus.Settled;

        if (tickets.length == 0) {
            emit WinnerDrawn(epoch, address(0), 0, randomWord);
            return;
        }

        address winner = tickets[randomWord % tickets.length];
        epochPrize[epoch] = 0;
        claimable[winner] += prize;
        totalClaimable += prize;

        emit WinnerDrawn(epoch, winner, prize, randomWord);
    }

    /// @notice Withdraw a prize credited by `ccipReceive`.
    function claimReward() external returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        // Effects before interaction.
        claimable[msg.sender] = 0;
        totalClaimable -= amount;

        PAYMENT_TOKEN.safeTransfer(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice Current epoch number (epoch 1 starts at GENESIS).
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - GENESIS) / EPOCH_DURATION + 1;
    }

    /// @notice Seconds until the current epoch ends.
    function timeUntilEpochEnd() external view returns (uint256) {
        uint256 end = GENESIS + currentEpoch() * EPOCH_DURATION;
        return end - block.timestamp;
    }

    /// @notice Number of tickets (stamps) in an epoch.
    function ticketCount(uint256 epoch) external view returns (uint256) {
        return _tickets[epoch].length;
    }

    /// @notice Ticket holder at a given index for an epoch.
    function ticketOf(uint256 epoch, uint256 index) external view returns (address) {
        return _tickets[epoch][index];
    }

    /// @notice Total number of notes on the wall.
    function getTotalNotes() external view returns (uint256) {
        return allNotes.length;
    }

    /// @notice Read a single note by id (reverts if it doesn't exist).
    function getNote(uint256 id) external view returns (Note memory) {
        return _noteOf(id);
    }

    /**
     * @notice Paginated read for the frontend.
     * @param offset Index to start from.
     * @param limit  Maximum number of notes to return.
     */
    function getNotes(uint256 offset, uint256 limit) external view returns (Note[] memory page) {
        uint256 total = allNotes.length;
        if (offset >= total) return new Note[](0);

        uint256 end = limit > total - offset ? total : offset + limit;
        uint256 n = end - offset;
        page = new Note[](n);
        for (uint256 i = 0; i < n; ) {
            page[i] = allNotes[offset + i];
            unchecked {
                ++i;
            }
        }
    }

    /// @notice On-chain token metadata as a base64 JSON data URI.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        Note memory n = _noteOf(tokenId);

        // Split into several abi.encodePacked calls to avoid "stack too deep".
        string memory header = string(
            abi.encodePacked(
                "{\"name\":\"IMD Note #",
                tokenId.toString(),
                "\",\"description\":\"A retro sticky note permanently stamped on the IMD Retro Wall.\",",
                "\"attributes\":["
            )
        );
        string memory author = string(
            abi.encodePacked(
                "{\"trait_type\":\"Author\",\"value\":\"",
                _toHex(n.author),
                "\"},"
            )
        );
        string memory color = string(
            abi.encodePacked("{\"trait_type\":\"Color\",\"value\":\"", n.color, "\"},")
        );
        string memory content = string(
            abi.encodePacked(
                "{\"trait_type\":\"Content\",\"value\":\"",
                _jsonEscape(n.content),
                "\"},"
            )
        );
        string memory pos = string(
            abi.encodePacked(
                "{\"trait_type\":\"posX\",\"value\":",
                uint256(n.posX).toString(),
                "},",
                "{\"trait_type\":\"posY\",\"value\":",
                uint256(n.posY).toString(),
                "}"
            )
        );
        string memory tail = string(
            abi.encodePacked(
                ",{\"trait_type\":\"Rotation\",\"value\":",
                _signedToString(n.rotation),
                "},",
                "{\"trait_type\":\"Timestamp\",\"value\":",
                n.timestamp.toString(),
                "}]}"
            )
        );

        string memory json = string(abi.encodePacked(header, author, color, content, pos, tail));

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _noteOf(uint256 id) internal view returns (Note memory) {
        if (id >= allNotes.length) revert NoteNotFound(id);
        return allNotes[id];
    }

    /// @dev Refunds native value above `fee` to the caller.
    function _refundExcess(uint256 provided, uint256 fee) private {
        uint256 excess = provided - fee;
        if (excess > 0) {
            (bool ok, ) = msg.sender.call{value: excess}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @dev Signed int8 -> decimal string, e.g. -12 -> "-12".
    function _signedToString(int8 v) internal pure returns (string memory) {
        if (v < 0) {
            return string(abi.encodePacked("-", uint256(-int256(v)).toString()));
        }
        return uint256(int256(v)).toString();
    }

    /// @dev Lowercases hex address into a "0x..." string for metadata.
    function _toHex(address a) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory s = new bytes(42);
        s[0] = "0";
        s[1] = "x";
        bytes20 b = bytes20(a);
        for (uint256 i = 0; i < 20; ) {
            s[2 + i * 2] = alphabet[uint8(b[i] >> 4)];
            s[3 + i * 2] = alphabet[uint8(b[i] & 0x0f)];
            unchecked {
                ++i;
            }
        }
        return string(s);
    }

    /// @dev Escapes a note's content for embedding in the metadata JSON
    ///      string (quotes, backslashes, and control characters).
    function _jsonEscape(string memory s) internal pure returns (string memory) {
        bytes memory inB = bytes(s);
        uint256 len = inB.length;
        // Worst case per byte: "\u00XX" = 6 chars.
        uint256 cap = len * 6;
        // Scratch buffer of raw bytes. Staying on the `uint8[]` type avoids a
        // solc 0.8.20 codegen quirk with `bytes` indexing inside unchecked loops.
        uint8[] memory buf = new uint8[](cap);
        uint256 j = 0;

        for (uint256 i = 0; i < len; ) {
            uint8 v = uint8(inB[i]);
            if (v == 0x22) {
                buf[j] = 0x5c;
                buf[j + 1] = 0x22;
                j += 2;
            } else if (v == 0x5c) {
                buf[j] = 0x5c;
                buf[j + 1] = 0x5c;
                j += 2;
            } else if (v == 0x0a) {
                buf[j] = 0x5c;
                buf[j + 1] = 0x6e;
                j += 2;
            } else if (v == 0x0d) {
                buf[j] = 0x5c;
                buf[j + 1] = 0x72;
                j += 2;
            } else if (v == 0x09) {
                buf[j] = 0x5c;
                buf[j + 1] = 0x74;
                j += 2;
            } else if (v < 0x20) {
                buf[j] = 0x5c;
                buf[j + 1] = 0x75;
                buf[j + 2] = 0x30;
                buf[j + 3] = 0x30;
                buf[j + 4] = uint8(bytes1(_hexDigit(v >> 4)));
                buf[j + 5] = uint8(bytes1(_hexDigit(v & 0x0f)));
                j += 6;
            } else {
                buf[j] = v;
                j += 1;
            }
            unchecked {
                ++i;
            }
        }

        bytes memory out = new bytes(j);
        for (uint256 k = 0; k < j; ) {
            out[k] = bytes1(buf[k]);
            unchecked {
                ++k;
            }
        }
        return string(out);
    }

    /// @dev Nibble (0..15) -> lowercase hex character.
    function _hexDigit(uint8 nibble) private pure returns (bytes1) {
        return
            nibble < 10
                ? bytes1(uint8(0x30) + nibble) // '0'..'9'
                : bytes1(uint8(0x61) + nibble - 10); // 'a'..'f'
    }

    /// @dev Accepts exactly "#RRGGBB" (7 bytes), case-insensitive.
    function _isValidHexColor(string calldata color) internal pure returns (bool) {
        bytes memory b = bytes(color);
        if (b.length != 7 || b[0] != "#") return false;

        for (uint256 i = 1; i < 7; ) {
            bytes1 c = b[i];
            bool ok = (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
            if (!ok) return false;
            unchecked {
                ++i;
            }
        }
        return true;
    }

    /// @dev Strict RFC 3629 UTF-8 validation (no overlongs, no surrogates,
    ///      nothing above U+10FFFF).
    function _isValidUtf8(bytes memory b) internal pure returns (bool) {
        uint256 len = b.length;
        uint256 i = 0;
        while (i < len) {
            uint8 c = uint8(b[i]);
            if (c < 0x80) {
                i += 1;
                continue;
            }

            uint256 need;
            uint8 lo = 0x80;
            uint8 hi = 0xBF;
            if (c >= 0xC2 && c <= 0xDF) {
                need = 1;
            } else if (c == 0xE0) {
                need = 2;
                lo = 0xA0;
            } else if (c >= 0xE1 && c <= 0xEC) {
                need = 2;
            } else if (c == 0xED) {
                need = 2;
                hi = 0x9F;
            } else if (c >= 0xEE && c <= 0xEF) {
                need = 2;
            } else if (c == 0xF0) {
                need = 3;
                lo = 0x90;
            } else if (c >= 0xF1 && c <= 0xF3) {
                need = 3;
            } else if (c == 0xF4) {
                need = 3;
                hi = 0x8F;
            } else {
                return false;
            }

            if (i + need >= len) return false;

            uint8 c1 = uint8(b[i + 1]);
            if (c1 < lo || c1 > hi) return false;
            for (uint256 k = 2; k <= need; ) {
                uint8 ck = uint8(b[i + k]);
                if (ck < 0x80 || ck > 0xBF) return false;
                unchecked {
                    ++k;
                }
            }
            i += need + 1;
        }
        return true;
    }
}
