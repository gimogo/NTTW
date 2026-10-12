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
    stateMutability: "payable",
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
  // Custom errors (surfaced in tx failures)
  { type: "error", name: "EmptyContent", inputs: [] },
  {
    type: "error",
    name: "ContentTooLong",
    inputs: [{ name: "length", type: "uint256" }],
  },
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
    name: "PageOutOfBounds",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "total", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "NoteNotFound",
    inputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "error",
    name: "IncorrectEthFee",
    inputs: [
      { name: "sent", type: "uint256" },
      { name: "required", type: "uint256" },
    ],
  },
  { type: "error", name: "EthTransferFailed", inputs: [] },
  { type: "error", name: "TokenTransferFailed", inputs: [] },
] as const;

/**
 * Payment constants for `stampNote` — keep in sync with
 * contracts/IMDRetroWall.sol (TOKEN_FEE, ETH_FEE).
 */
export const PAYMENT_TOKEN_ADDRESS =
  "0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105" as const;
/** 0.02 FRNPET (18 decimals) in base units. */
export const TOKEN_FEE = 20_000_000_000_000_000n; // 0.02e18
/** 0.00005 ETH in wei. */
export const ETH_FEE = 50_000_000_000_000n; // 5e13
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
