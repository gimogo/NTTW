/**
 * Hand-written ABI + address resolution for IMDRetroWall.sol.
 * Keep in sync with contracts/IMDRetroWall.sol.
 */

const noteComponents = [
  { name: "id", type: "uint256" },
  { name: "author", type: "address" },
  { name: "content", type: "string" },
  { name: "color", type: "string" },
  { name: "posX", type: "uint16" },
  { name: "posY", type: "uint16" },
  { name: "rotation", type: "int8" },
  { name: "timestamp", type: "uint256" },
] as const;

export const retroNotesAbi = [
  {
    type: "function",
    name: "stampNote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_content", type: "string" },
      { name: "_color", type: "string" },
      { name: "_posX", type: "uint16" },
      { name: "_posY", type: "uint16" },
      { name: "_rotation", type: "int8" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getTotalNotes",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getNotes",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "page", type: "tuple[]", components: noteComponents }],
  },
  {
    type: "function",
    name: "getNote",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: noteComponents }],
  },
  {
    type: "function",
    name: "allNotes",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "author", type: "address" },
      { name: "content", type: "string" },
      { name: "color", type: "string" },
      { name: "posX", type: "uint16" },
      { name: "posY", type: "uint16" },
      { name: "rotation", type: "int8" },
      { name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "NoteCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "author", type: "address", indexed: true },
      { name: "content", type: "string", indexed: false },
      { name: "color", type: "string", indexed: false },
      { name: "posX", type: "uint16", indexed: false },
      { name: "posY", type: "uint16", indexed: false },
      { name: "rotation", type: "int8", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "timeUntilEpochEnd",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "stampsInEpoch",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ticketCount",
    stateMutability: "view",
    inputs: [{ name: "epoch", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ticketOf",
    stateMutability: "view",
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "epochPrize",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "settlementStatus",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    // 0 = None, 1 = Requested, 2 = Settled
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "requestSettlement",
    stateMutability: "payable",
    inputs: [{ name: "epoch", type: "uint256" }],
    outputs: [{ name: "messageId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "claimReward",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "event",
    name: "SettlementRequested",
    inputs: [
      { name: "epoch", type: "uint256", indexed: true },
      { name: "messageId", type: "bytes32", indexed: true },
      { name: "caller", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "WinnerDrawn",
    inputs: [
      { name: "epoch", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "prize", type: "uint256", indexed: false },
      { name: "randomWord", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RewardClaimed",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // Custom errors (surfaced in tx failures)
  { type: "error", name: "EmptyContent", inputs: [] },
  {
    type: "error",
    name: "ContentTooLong",
    inputs: [{ name: "length", type: "uint256" }],
  },
  { type: "error", name: "InvalidUtf8", inputs: [] },
  {
    type: "error",
    name: "StampLimitReached",
    inputs: [{ name: "limit", type: "uint256" }],
  },
  {
    type: "error",
    name: "EpochNotEnded",
    inputs: [{ name: "epoch", type: "uint256" }],
  },
  {
    type: "error",
    name: "EpochAlreadySettled",
    inputs: [{ name: "epoch", type: "uint256" }],
  },
  {
    type: "error",
    name: "SettlementPending",
    inputs: [
      { name: "epoch", type: "uint256" },
      { name: "retryAt", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "InsufficientFee",
    inputs: [
      { name: "required", type: "uint256" },
      { name: "provided", type: "uint256" },
    ],
  },
  { type: "error", name: "RelayNotSet", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  {
    type: "error",
    name: "InvalidColor",
    inputs: [{ name: "color", type: "string" }],
  },
  {
    type: "error",
    name: "InvalidRotation",
    inputs: [{ name: "rotation", type: "int8" }],
  },
  {
    type: "error",
    name: "NoteNotFound",
    inputs: [{ name: "id", type: "uint256" }],
  },
  { type: "error", name: "TokenTransferFailed", inputs: [] },
] as const;

/**
 * Payment constants for `stampNote` — keep in sync with
 * contracts/IMDRetroWall.sol (TOKEN_FEE, TOKEN_FEE_BURN_SHARE,
 * TOKEN_FEE_POOL_SHARE). The stamp fee is token-only (no ETH).
 */
/**
 * Payment-token address from env. The wall takes the token address in its
 * constructor, so after deploying it must be mirrored here:
 *   NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0x...
 * in .env.local. Without it the approve/stamp flow is disabled.
 */
export function getPaymentTokenAddress(): `0x${string}` | undefined {
  const raw = process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return undefined;
  return raw as `0x${string}`;
}
/** 1000 tokens (18 decimals) in base units — the full stamp fee. */
export const TOKEN_FEE = 1_000_000_000_000_000_000_000n; // 1000e18
/** 50% of the fee — burned to the dead address. */
export const TOKEN_FEE_BURN_SHARE = 500_000_000_000_000_000_000n; // 500e18
/** 50% of the fee — kept in the contract as the epoch's prize pool. */
export const TOKEN_FEE_POOL_SHARE = 500_000_000_000_000_000_000n; // 500e18
/** Unlimited approval sentinel (type(uint256).max) — approve once, stamp freely. */
export const MAX_UINT256 = 2n ** 256n - 1n;

/** Minimal ERC-20 ABI for approve / allowance (payment token). */
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** A note as rendered on the board. */
export type BoardNote = {
  id: number;
  author: string;
  content: string;
  color: string;
  posX: number;
  posY: number;
  rotation: number;
  timestamp: number;
};

/**
 * A decoded `Note` as returned by viem — a struct with named fields.
 * (viem surfaces tuple components as named object properties.)
 */
export type RawNote = {
  id: bigint | number;
  author: string;
  content: string;
  color: string;
  posX: bigint | number;
  posY: bigint | number;
  rotation: bigint | number;
  timestamp: bigint | number;
};

/** Normalize a viem-decoded struct (or positional tuple) into a BoardNote. */
export function rawToNote(raw: RawNote | readonly unknown[]): BoardNote {
  const r = raw as RawNote;
  return {
    id: Number(r.id),
    author: String(r.author),
    content: r.content,
    color: r.color,
    posX: Number(r.posX),
    posY: Number(r.posY),
    rotation: Number(r.rotation),
    timestamp: Number(r.timestamp),
  };
}

/**
 * Contract address from env. Set
 *   NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=0x...
 * in .env.local after deploying.
 */
export function getNotesContractAddress():
  | `0x${string}`
  | undefined {
  const raw = process.env.NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return undefined;
  return raw as `0x${string}`;
}
