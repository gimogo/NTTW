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
 *         IMD Protocol Hackathon build.
 *
 *         Design goals (Base / Base Sepolia L2):
 *           - No admin, no upgradability, no pause: once deployed, the wall
 *             belongs to everyone forever.
 *           - Custom errors instead of require-strings (cheaper reverts).
 *           - Paginated reads (`getNotes`) so the frontend never pulls the
 *             whole array in one eth_call.
 *           - Events carry the full payload so an indexer / frontend listener
 *             can render new notes in real time without extra reads.
 *
 *         The public array getter `allNotes(uint256)` is auto-generated and
 *         returns the struct's value-type fields; use `getNotes`/`getNote`
 *         to also retrieve the string fields.
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
    // Constants
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

    /// @notice ERC-20 charged per stamp (Fren Pet / FRNPET on Base mainnet),
    ///         18 decimals. 0.1 token = 10^17 base units.
    IERC20 public constant PAYMENT_TOKEN =
        IERC20(0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105);

    /// @notice Token fee per stamp, in PAYMENT_TOKEN base units (0.02 FRNPET).
    uint256 public constant TOKEN_FEE = 2e16;

    /// @notice Canonical burn (dead) address the token fee is sent to and
    ///         permanently destroyed at.
    address public constant TOKEN_BURN =
        0x000000000000000000000000000000000000dEaD;

    /// @notice ETH fee per stamp, in wei (0.00005 ETH).
    uint256 public constant ETH_FEE = 50_000_000_000_000;

    /// @notice Fixed recipient of the ETH fee. Hardcoded (immutable-style
    ///         constant) per spec — not the deployer, not changeable.
    address public constant ETH_RECIPIENT = 0x8d5Ba1fc60fe4d6FB41ED2176f3f2E05FEBC0cA5;

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

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error EmptyContent();
    error ContentTooLong(uint256 length);
    error InvalidColor(string color);
    error InvalidRotation(int8 rotation);
    error PageOutOfBounds(uint256 offset, uint256 total);
    error NoteNotFound(uint256 id);
    error IncorrectEthFee(uint256 sent, uint256 required);
    error EthTransferFailed();
    error TokenTransferFailed();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() ERC721("IMD Retro Wall Note", "IMDNOTE") {}

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /**
     * @notice Stamp a new note permanently on the wall and mint its NFT.
     *         Payment is enforced atomically in this same call:
     *           - `msg.value` must equal `ETH_FEE`; it is forwarded to
     *             `ETH_RECIPIENT` immediately.
     *           - `TOKEN_FEE` (0.02 PAYMENT_TOKEN) is pulled from `msg.sender`
     *             (requires a prior `approve`) and sent to `TOKEN_BURN`, where
     *             it is destroyed.
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
    ) external payable returns (uint256 id) {
        uint256 len = bytes(_content).length;
        if (len == 0) revert EmptyContent();
        if (len > MAX_CONTENT_BYTES) revert ContentTooLong(len);
        if (!_isValidHexColor(_color)) revert InvalidColor(_color);
        if (_rotation < MIN_ROTATION || _rotation > MAX_ROTATION) {
            revert InvalidRotation(_rotation);
        }

        // --- Payment: ETH fee (exact) ---
        if (msg.value != ETH_FEE) revert IncorrectEthFee(msg.value, ETH_FEE);

        // --- Payment: token fee, pulled then burned ---
        // Pull 0.02 FRNPET from the sender (needs prior approve) straight to
        // the dead address, so it is destroyed in one transfer with no
        // intermediate balance held by this contract.
        if (!PAYMENT_TOKEN.transferFrom(msg.sender, TOKEN_BURN, TOKEN_FEE)) {
            revert TokenTransferFailed();
        }

        // Forward the ETH fee to the fixed recipient.
        (bool ok, ) = payable(ETH_RECIPIENT).call{value: msg.value}("");
        if (!ok) revert EthTransferFailed();

        id = allNotes.length; // ids are sequential, starting at 0
        uint256 ts = block.timestamp;

        allNotes.push(
            Note(id, msg.sender, _content, _color, _posX, _posY, _rotation, ts)
        );

        // Mint the note as a unique ERC-721 to its author.
        _safeMint(msg.sender, id);

        emit NoteCreated(id, msg.sender, _content, _color, _posX, _posY, _rotation, ts);
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
            abi.encodePacked(header, author, color, pos, tail)
        );

        return string(abi.encodePacked("data:application/json,", json));
    }

    // ---------------------------------------------------------------------
    // Internals
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
