// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IMDRetroWall
 * @notice A fully autonomous, immutable, ownerless sticky-note wall where
 *         every stamped note is minted on-chain as a unique ERC-721 NFT.
 *
 *         Gamified weekly reward economy (standalone ERC-721; no Uniswap
 *         hooks):
 *           - `stampNote` charges a fixed TOKEN_FEE in the project ERC-20:
 *             50% is burned, 50% accrues to `weeklyRewardPool`.
 *           - Time is split into 7-day epochs. Every epoch keeps a live
 *             top-10 leaderboard (`currentTopMinters`) maintained
 *             incrementally with a bounded insertion sort (max 10 slots).
 *           - The first stamp after an epoch boundary rolls the epoch over:
 *             the pool is distributed 30/15/15/8/8/8/4/4/4/4 (%) by rank,
 *             empty slots are skipped (their share rolls over), the board
 *             is cleared, and the counters restart.
 *
 *         Design goals (EVM L2s — Robinhood Chain / Base Sepolia):
 *           - No admin, no upgradability, no pause: once deployed, the wall
 *             belongs to everyone forever.
 *           - Custom errors instead of require-strings (cheaper reverts).
 *           - Checks-Effects-Interactions ordering in every write path.
 *           - Paginated reads (`getNotes`) so the frontend never pulls the
 *             whole array in one eth_call.
 *           - Events carry the full payload so an indexer / frontend listener
 *             can render new notes in real time without extra reads.
 *
 *         The public array getter `allNotes(uint256)` is auto-generated and
 *         returns the struct's value-type fields; use `getNotes`/`getNote`
 *         to also retrieve the string fields.
 *
 *         Payment-token assumption: `PAYMENT_TOKEN` is a standard ERC-20
 *         without transfer hooks (no callbacks on transfer/transferFrom),
 *         so CEI ordering alone makes the state machine reentrancy-safe.
 */
contract IMDRetroWall is ERC721, ERC721Enumerable {
    using Strings for uint256;

    /// @dev Both ERC721 and ERC721Enumerable define `supportsInterface`,
    ///      so the derived contract must override it to disambiguate.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @dev Both ERC721 and ERC721Enumerable hook `_update`; override to
    ///      keep ERC721Enumerable's bookkeeping in sync with transfers/mints.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    /// @dev Also override `_increaseBalance` (required by ERC721Enumerable).
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

    /// @notice Maximum note content length, in bytes (UTF-8), per the spec.
    uint256 public constant MAX_CONTENT_BYTES = 280;

    /// @notice Minimum tilt allowed for a note (degrees).
    int8 public constant MIN_ROTATION = -15;

    /// @notice Maximum tilt allowed for a note (degrees).
    int8 public constant MAX_ROTATION = 15;

    /// @notice Maximum X/Y coordinate (uint16 space). The board is a
    ///         65535 x 65535 virtual canvas; the frontend maps viewport
    ///         pixels / percentages into this space.
    uint16 public constant MAX_POSITION = type(uint16).max;

    // ---------------------------------------------------------------------
    // Payment constants
    // ---------------------------------------------------------------------

    /// @notice Custom ERC-20 charged per stamp. Set once in the constructor
    ///         and immutable afterwards — the deployed token must be a
    ///         standard ERC-20 compliant 18-decimal token.
    IERC20 public immutable PAYMENT_TOKEN;

    /// @notice Total token fee per stamp, in PAYMENT_TOKEN base units
    ///         (1000 tokens, 18 decimals).
    uint256 public constant TOKEN_FEE = 1000e18;

    /// @notice Half of TOKEN_FEE — pulled from the staker straight to the
    ///         dead address and destroyed in the same transfer.
    uint256 public constant TOKEN_FEE_BURN_SHARE = TOKEN_FEE / 2; // 500e18

    /// @notice The other half of TOKEN_FEE — pulled from the staker into
    ///         this contract and added to `weeklyRewardPool`.
    uint256 public constant TOKEN_FEE_POOL_SHARE = TOKEN_FEE - TOKEN_FEE_BURN_SHARE; // 500e18

    /// @notice Canonical burn (dead) address the burn share is sent to and
    ///         permanently destroyed at.
    address public constant TOKEN_BURN =
        0x000000000000000000000000000000000000dEaD;

    // ---------------------------------------------------------------------
    // Epoch constants
    // ---------------------------------------------------------------------

    /// @notice One epoch lasts exactly 7 days.
    uint256 public constant EPOCH_DURATION = 7 days;

    /// @notice Leaderboard size — a fixed top 10.
    uint256 public constant LEADERBOARD_SIZE = 10;

    /// @notice Basis-point denominator for the rank shares (100% = 10 000).
    uint256 private constant BASIS_POINTS = 10_000;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Note {
        uint256 id;
        address author;
        string content; // max 280 bytes
        string color; // "#RRGGBB" hex string
        uint16 posX; // 0..65535 virtual canvas X
        uint16 posY; // 0..65535 virtual canvas Y
        int8 rotation; // -15..15 degrees
        uint256 timestamp;
    }

    /// @notice Append-only wall of notes. Newer notes have higher ids —
    ///         the frontend derives stacking z-index from this.
    Note[] public allNotes;

    /// @notice Current epoch number; starts at 1 and increments every
    ///         EPOCH_DURATION (lazily, on the first stamp after the boundary).
    uint256 public currentEpoch = 1;

    /// @notice Timestamp the current epoch started. Set at deployment and
    ///         refreshed on every epoch rollover.
    uint256 public epochStartTime;

    /// @notice Token pool accrued this epoch: the 50% pool share of every
    ///         stamp. Distributed to the top 10 on rollover; any share not
    ///         distributed (empty leaderboard slots) rolls over.
    uint256 public weeklyRewardPool;

    /// @notice Per-epoch stamped-note counter: epoch => author => count.
    mapping(uint256 => mapping(address => uint256)) public noteCountPerEpoch;

    /// @notice Fixed-size leaderboard for the current epoch, best first.
    ///         address(0) means the slot is empty.
    address[10] public currentTopMinters;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted on every successful stamp. Indexed fields allow
    ///         filtered subscriptions (`id`, `author`).
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

    /// @notice Emitted when a winner receives its rank share on rollover.
    event RewardPaid(address indexed winner, uint256 indexed rank, uint256 amount);

    /// @notice Emitted once per epoch rollover with the full settlement.
    event EpochAdvanced(
        uint256 indexed previousEpoch,
        uint256 indexed newEpoch,
        uint256 distributed,
        uint256 rolledOverPool
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error EmptyPaymentToken();

    error EmptyContent();
    error ContentTooLong(uint256 length);
    error InvalidColor(string color);
    error InvalidRotation(int8 rotation);
    error PageOutOfBounds(uint256 offset, uint256 total);
    error NoteNotFound(uint256 id);
    error TokenTransferFailed();
    error RewardTransferFailed(address winner);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(IERC20 _paymentToken) ERC721("IMD Retro Wall Note", "IMDNOTE") {
        if (address(_paymentToken) == address(0)) {
            // the fee is token-only; a null token would make every stamp fail
            revert EmptyPaymentToken();
        }
        PAYMENT_TOKEN = _paymentToken;
        epochStartTime = block.timestamp;
    }

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /**
     * @notice Stamp a new note permanently on the wall, mint its NFT, and
     *         enter the author into the current epoch's leaderboard.
     *         Payment (token only — no ETH) is enforced atomically:
     *           - `TOKEN_FEE_BURN_SHARE` (50 tokens) is pulled from
     *             `msg.sender` straight to `TOKEN_BURN` (destroyed).
     *           - `TOKEN_FEE_POOL_SHARE` (50 tokens) is pulled from
     *             `msg.sender` into this contract and added to
     *             `weeklyRewardPool`.
     *         Requires a prior ERC-20 `approve` of at least TOKEN_FEE.
     * @dev  Rolls the epoch over first if a 7-day boundary has passed, so
     *       the stamp is counted into the fresh epoch.
     * @param _content  Note text, 1..280 UTF-8 bytes.
     * @param _color    Hex color, exactly "#RRGGBB" (or "0xRRGGBB").
     * @param _posX     X coordinate on the 65535-wide virtual canvas.
     * @param _posY     Y coordinate on the 65535-tall virtual canvas.
     * @param _rotation Tilt in degrees, -15..15.
     * @return id       The id of the newly minted note / token.
     */
    function stampNote(
        string calldata _content,
        string calldata _color,
        uint16 _posX,
        uint16 _posY,
        int8 _rotation
    ) external returns (uint256 id) {
        // --- Epoch rollover (previous epoch's pool settlement) ---
        if (block.timestamp >= epochStartTime + EPOCH_DURATION) {
            _processEpochReset();
        }

        // --- Checks ---
        uint256 len = bytes(_content).length;
        if (len == 0) revert EmptyContent();
        if (len > MAX_CONTENT_BYTES) revert ContentTooLong(len);
        if (!_isValidHexColor(_color)) revert InvalidColor(_color);
        if (_rotation < MIN_ROTATION || _rotation > MAX_ROTATION) {
            revert InvalidRotation(_rotation);
        }

        // --- Effects ---
        id = allNotes.length; // ids are sequential, starting at 0
        uint256 ts = block.timestamp;

        allNotes.push(
            Note(id, msg.sender, _content, _color, _posX, _posY, _rotation, ts)
        );

        // Per-epoch counter + live leaderboard maintenance.
        uint256 newCount = ++noteCountPerEpoch[currentEpoch][msg.sender];
        _updateLeaderboard(msg.sender, newCount);

        // Accrue this stamp's pool share (the transfer below is atomic with
        // it — a failed pull reverts the accrual too).
        weeklyRewardPool += TOKEN_FEE_POOL_SHARE;

        emit NoteCreated(id, msg.sender, _content, _color, _posX, _posY, _rotation, ts);

        // --- Interactions ---
        // 50% of the fee: straight to the dead address (burned).
        if (!PAYMENT_TOKEN.transferFrom(msg.sender, TOKEN_BURN, TOKEN_FEE_BURN_SHARE)) {
            revert TokenTransferFailed();
        }
        // 50% of the fee: into the contract, backing weeklyRewardPool.
        if (
            !PAYMENT_TOKEN.transferFrom(msg.sender, address(this), TOKEN_FEE_POOL_SHARE)
        ) {
            revert TokenTransferFailed();
        }

        // Mint the note as a unique ERC-721 to its author.
        _safeMint(msg.sender, id);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice Total number of notes on the wall.
    function getTotalNotes() external view returns (uint256) {
        return allNotes.length;
    }

    /**
     * @notice Paginated read for the frontend.
     * @param offset Index to start from (0-based).
     * @param limit  Maximum number of notes to return.
     * @return page  Slice [offset, min(offset + limit, total)).
     */
    function getNotes(
        uint256 offset,
        uint256 limit
    ) external view returns (Note[] memory page) {
        uint256 total = allNotes.length;
        if (offset > total) revert PageOutOfBounds(offset, total);

        uint256 end = offset + limit;
        if (end > total) end = total;

        uint256 n = end - offset;
        page = new Note[](n);
        for (uint256 i = 0; i < n; ) {
            page[i] = allNotes[offset + i];
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Read a single note by id (reverts if it doesn't exist).
    function getNote(uint256 id) external view returns (Note memory) {
        if (id >= allNotes.length) revert NoteNotFound(id);
        return allNotes[id];
    }

    /// @notice Batch read of the live leaderboard (rank 1 first; zero
    ///         addresses mean fewer than 10 minters this epoch).
    function getCurrentTopMinters() external view returns (address[10] memory) {
        return currentTopMinters;
    }

    /// @notice Seconds until the next epoch rollover (0 once due; the next
    ///         stamp settles the epoch).
    function timeUntilEpochEnd() external view returns (uint256) {
        uint256 end = epochStartTime + EPOCH_DURATION;
        return block.timestamp >= end ? 0 : end - block.timestamp;
    }

    /// @notice On-chain token metadata (data URI). Exposes the note's
    ///         content, author, color, position and rotation so each NFT
    ///         is fully self-describing without an off-chain server.
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
            abi.encodePacked(
                "{\"trait_type\":\"Color\",\"value\":\"",
                n.color,
                "\"},"
            )
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

        string memory json = string(
            abi.encodePacked(header, author, color, content, pos, tail)
        );

        return string(abi.encodePacked("data:application/json,", json));
    }

    // ---------------------------------------------------------------------
    // Internals — leaderboard
    // ---------------------------------------------------------------------

    /**
     * @dev Keeps `currentTopMinters` sorted with a bounded insertion sort
     *      (fixed 10 slots, at most 10 iterations per pass):
     *        1. If the minter already holds a slot, shift the tail up one to
     *           close the gap.
     *        2. Scan from rank 1 and insert before the first slot whose
     *           count is strictly smaller (or the first empty slot).
     *      Tie-breaker: the scan uses a STRICT `<` comparison, so a member
     *      that already holds a given count keeps the higher rank over any
     *      later arrival reaching the same count.
     */
    function _updateLeaderboard(address minter, uint256 newCount) private {
        // Pass 1: locate and evict the minter's current slot, if any.
        for (uint256 i = 0; i < LEADERBOARD_SIZE; ) {
            if (currentTopMinters[i] == minter) {
                for (uint256 j = i; j < LEADERBOARD_SIZE - 1; ) {
                    currentTopMinters[j] = currentTopMinters[j + 1];
                    unchecked {
                        ++j;
                    }
                }
                currentTopMinters[LEADERBOARD_SIZE - 1] = address(0);
                break;
            }
            unchecked {
                ++i;
            }
        }

        // Pass 2: find the insertion rank (first strictly-lower count, or
        // the first empty slot). insertAt == 10 → didn't make the board.
        uint256 insertAt = LEADERBOARD_SIZE;
        for (uint256 i = 0; i < LEADERBOARD_SIZE; ) {
            address holder = currentTopMinters[i];
            if (holder == address(0) || noteCountPerEpoch[currentEpoch][holder] < newCount) {
                insertAt = i;
                break;
            }
            unchecked {
                ++i;
            }
        }
        if (insertAt == LEADERBOARD_SIZE) return;

        // Shift the tail down one slot and place the minter.
        for (uint256 i = LEADERBOARD_SIZE - 1; i > insertAt; ) {
            currentTopMinters[i] = currentTopMinters[i - 1];
            unchecked {
                --i;
            }
        }
        currentTopMinters[insertAt] = minter;
    }

    // ---------------------------------------------------------------------
    // Internals — epoch rollover
    // ---------------------------------------------------------------------

    /**
     * @dev Settles the ending epoch, strictly CEI-style: every storage
     *      effect (pool accounting, leaderboard clear, epoch bump) is
     *      committed BEFORE the single external interaction type (ERC-20
     *      transfers to winners).
     *
     *      Rank shares (basis points): 1st 30%, 2nd-3rd 15% each,
     *      4th-6th 8% each, 7th-10th 4% each (sums to exactly 100%).
     *      Empty slots are skipped; their share stays in the contract and
     *      rolls over into the next epoch's pool. Both share computations
     *      below use identical integer math, so the summed transfers match
     *      `distributed` to the wei.
     */
    function _processEpochReset() private {
        uint256 pool = weeklyRewardPool;
        address[10] memory winners = currentTopMinters; // snapshot for payouts

        // Rank shares; identical literal in both loops by construction.
        uint256[10] memory shareBps = [
            uint256(3000),
            1500,
            1500,
            800,
            800,
            800,
            400,
            400,
            400,
            400
        ];

        // ---- Effects ----
        uint256 distributed;
        if (pool > 0) {
            for (uint256 i = 0; i < LEADERBOARD_SIZE; ) {
                if (winners[i] != address(0)) {
                    distributed += (pool * shareBps[i]) / BASIS_POINTS;
                }
                unchecked {
                    ++i;
                }
            }
            // Rollover: only what was actually claimed leaves the pool.
            weeklyRewardPool = pool - distributed;
        }
        for (uint256 i = 0; i < LEADERBOARD_SIZE; ) {
            currentTopMinters[i] = address(0);
            unchecked {
                ++i;
            }
        }
        uint256 previousEpoch = currentEpoch;
        currentEpoch = previousEpoch + 1;
        epochStartTime = block.timestamp;

        // ---- Interactions ----
        if (pool > 0) {
            for (uint256 i = 0; i < LEADERBOARD_SIZE; ) {
                address winner = winners[i];
                if (winner != address(0)) {
                    uint256 share = (pool * shareBps[i]) / BASIS_POINTS;
                    if (share > 0) {
                        if (!PAYMENT_TOKEN.transfer(winner, share)) {
                            revert RewardTransferFailed(winner);
                        }
                        emit RewardPaid(winner, i + 1, share);
                    }
                }
                unchecked {
                    ++i;
                }
            }
        }

        emit EpochAdvanced(previousEpoch, currentEpoch, distributed, weeklyRewardPool);
    }

    // ---------------------------------------------------------------------
    // Internals — helpers
    // ---------------------------------------------------------------------

    /// @dev Fetches a note by id, reverting if it does not exist. Reuses the
    ///      same check as the public `getNote` reader.
    function _noteOf(uint256 id) internal view returns (Note memory) {
        if (id >= allNotes.length) revert NoteNotFound(id);
        return allNotes[id];
    }

    /// @dev Renders a signed int8 as a decimal string.
    function _signedToString(int8 v) internal pure returns (string memory) {
        if (v >= 0) return uint256(uint8(v)).toString();
        return string(abi.encodePacked("-", uint256(uint8(-v)).toString()));
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

    /// @dev Escapes a note's content for embedding in the tokenURI JSON
    ///      string (quotes, backslashes, and control characters), so any
    ///      valid UTF-8 note renders as legal JSON metadata.
    function _jsonEscape(string memory s) internal pure returns (string memory) {
        bytes memory inB = bytes(s);
        uint256 len = inB.length;
        // Worst case per byte: "\u00XX" = 6 chars.
        uint256 cap = len * 6;
        // Scratch buffer of raw bytes. Staying on the `uint8[]` type (instead
        // of indexing `bytes` directly) sidesteps a solc 0.8.20 codegen quirk
        // where a `bytes` index inside an `unchecked` loop can still panic
        // 0x32 out-of-bounds; we cast to `bytes` once, at the end.
        uint8[] memory buf = new uint8[](cap);
        uint256 j = 0;

        for (uint256 i = 0; i < len; ) {
            uint8 v = uint8(inB[i]);
            if (v == 0x22) {
                // '"'
                buf[j] = 0x5c;
                buf[j + 1] = 0x22;
                j += 2;
            } else if (v == 0x5c) {
                // '\\'
                buf[j] = 0x5c;
                buf[j + 1] = 0x5c;
                j += 2;
            } else if (v == 0x0a) {
                // '\n'
                buf[j] = 0x5c;
                buf[j + 1] = 0x6e;
                j += 2;
            } else if (v == 0x0d) {
                // '\r'
                buf[j] = 0x5c;
                buf[j + 1] = 0x72;
                j += 2;
            } else if (v == 0x09) {
                // '\t'
                buf[j] = 0x5c;
                buf[j + 1] = 0x74;
                j += 2;
            } else if (v < 0x20) {
                // Other control chars -> \u00XX
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
        return nibble < 10
            ? bytes1(uint8(0x30) + nibble) // '0'..'9'
            : bytes1(uint8(0x61) + nibble - 10); // 'a'..'f'
    }

    /// @dev Accepts "#RRGGBB" (7 bytes) or "0xRRGGBB" (8 bytes), case-insensitive.
    function _isValidHexColor(string calldata color) internal pure returns (bool) {
        bytes memory b = bytes(color);

        uint256 start;
        if (b.length == 7 && b[0] == "#") {
            start = 1;
        } else if (b.length == 8 && b[0] == "0" && b[1] == "x") {
            start = 2;
        } else {
            return false;
        }

        for (uint256 i = start; i < b.length; ) {
            bytes1 c = b[i];
            bool ok = (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
            if (!ok) return false;
            unchecked {
                ++i;
            }
        }
        return true;
    }
}
