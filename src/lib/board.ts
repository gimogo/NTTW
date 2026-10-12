/** Virtual board dimensions (maps 1:1 to the contract's uint16 space). */
export const BOARD_WIDTH = 3200;
export const BOARD_HEIGHT = 2200;

/** Sticky note render size in board pixels. */
export const NOTE_WIDTH = 220;
export const NOTE_MIN_HEIGHT = 200;

/** Pastel palette — must match the design system. */
export const NOTE_COLORS: { name: string; hex: string }[] = [
  { name: "Sunbeam", hex: "#FFF2A5" },
  { name: "Bubblegum", hex: "#FFC5D0" },
  { name: "Sky", hex: "#AEE2FF" },
  { name: "Mint", hex: "#C8FFD4" },
  { name: "Lilac", hex: "#E4D4FF" },
  { name: "Peach", hex: "#FFD9B0" },
];

export const MAX_CONTENT_LENGTH = 280;
export const MIN_ROTATION = -15;
export const MAX_ROTATION = 15;

/** Deterministic push-pin colors, keyed by note id. */
export const PIN_COLORS = [
  "#E4572E",
  "#17BEBB",
  "#FF6F91",
  "#3A86FF",
  "#8338EC",
  "#06D6A0",
];

/** Deterministic washi-tape colors, keyed by note id. */
export const TAPE_COLORS = [
  "rgba(255, 214, 165, 0.75)",
  "rgba(174, 226, 255, 0.75)",
  "rgba(255, 197, 208, 0.75)",
  "rgba(200, 255, 212, 0.75)",
  "rgba(228, 212, 255, 0.75)",
];

export function randomRotation(): number {
  return Math.floor(Math.random() * (MAX_ROTATION - MIN_ROTATION + 1)) + MIN_ROTATION;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function truncateAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}...${address.slice(-chars)}`;
}

export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "just now";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

/** Sample notes so the board looks alive before a contract is wired up. */
export const DEMO_NOTES = [
  {
    id: 3,
    author: "0x9c1fA5074B3e2D99cC01e0F8Aa2B1dD4c3E5F607",
    content:
      "gm ☕ drag the ghost note anywhere, then stamp it on-chain. It lives there forever — no takebacks!",
    color: "#FFF2A5",
    posX: 2560,
    posY: 320,
    rotation: 6,
    timestamp: Math.floor(Date.now() / 1000) - 3600,
  },
  {
    id: 2,
    author: "0x4dB28F61C7A9e034512bB19F7A09Dd2f8E1C4A19",
    content: "Notes stack like real paper. Hover a note to peek at the ones buried underneath.",
    color: "#FFC5D0",
    posX: 300,
    posY: 1280,
    rotation: -9,
    timestamp: Math.floor(Date.now() / 1000) - 7200,
  },
  {
    id: 1,
    author: "0x7Fa3E152Bd04c6E1993aCc54B2e0Df018Ac77D21",
    content: "Every note is an NFT-free, pure on-chain string. 280 chars max. Make 'em count.",
    color: "#AEE2FF",
    posX: 1500,
    posY: 1020,
    rotation: 3,
    timestamp: Math.floor(Date.now() / 1000) - 86400,
  },
  {
    id: 0,
    author: "0x12349F61C7A9e034512bB19F7A09Dd2f8E1C4A19",
    content: "Welcome to the corkboard 📌",
    color: "#C8FFD4",
    posX: 1420,
    posY: 260,
    rotation: -4,
    timestamp: Math.floor(Date.now() / 1000) - 172800,
  },
];
