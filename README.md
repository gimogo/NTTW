# 📌 Notes To The World

A **decentralized, permanent sticky-note corkboard** for **Base** (mainnet + Sepolia testnet).
Every note is a real on-chain `string` — 280 characters max — pinned to an X/Y spot on a
tactile retro cork wall, **and minted as a unique ERC-721 NFT** to its author.
Notes overlap like real paper: newer notes stack on top, and hovering peels the top note
back to hint at what's buried underneath.

Stamping is **paid on-chain**: every stamp burns **0.02 FRNPET** (the payment token on
Base mainnet) and forwards **0.00005 ETH** to a fixed recipient — enforced atomically in
the same transaction.

```
┌─────────────────────────────────────────────────────────────┐
│  📌 NOTES [TO THE] WORLD                     0x1234...abcd  │
├─────────────────────────────────────────────────────────────┤
│   ╭──────╮          ╭────────╮                              │
│   │ gm 🧡│   ╭──────│ wagmi  │╮     ← overlapping pastel    │
│   ╰──╥───╯   │ n.2  ╰────────╯│       sticky notes with     │
│      ║   ╭───╰────╮  ╭─────╮  │       random tilt, pins &   │
│      ║   │ stack! │  │build│  │       washi tape             │
│      ╰───╰────────╯  ╰─────╯──╯                             │
│                                                             │
│   [ scrollable 3200×2200 cork canvas · z-index = note id ]  │
└─────────────────────────────────────────────────────────────┘
                                  [+ Sticky Note] ← FAB
```

---

## 1 · Tech stack

| Layer        | Tech                                                              |
| ------------ | ----------------------------------------------------------------- |
| Smart chain  | **Base** mainnet (+ **Base Sepolia** testnet for read-only work)   |
| Contract     | Solidity `0.8.20` (optimizer 200, EVM **paris**), **ERC-721**      |
| Payment      | **FRNPET** ERC-20 (`0xFF0C…E105`) burned per stamp + flat ETH fee  |
| Contract env | Hardhat 2 + hardhat-ethers + hardhat-chai-matchers                 |
| Frontend     | Next.js 14 (App Router), React 18, Tailwind CSS 3                 |
| Web3         | wagmi 2 + viem 2 (+ optional WalletConnect), TanStack Query 5     |
| Animation    | Framer Motion 11 (drag, hover peel, entrances) + Lucide icons     |
| Type/fonts   | TypeScript 5, Google Fonts **Caveat** (notes) + **VT323** (UI)    |

---

## 2 · Project structure

```
contracts/
  IMDRetroWall.sol              # the immutable notes wall + ERC-721 minting + paid stamping
  MockPaymentToken.sol          # ERC-20 mock, used only by tests (attached via hardhat_setCode)
scripts/deploy.ts               # deploy script (prints env hint)
test/IMDRetroWall.ts            # hardhat tests (validation, events, pagination, payments)
hardhat.config.ts               # 0.8.20 / optimizer / Base networks only
tsconfig.hardhat.json           # CommonJS tsconfig for hardhat scripts + tests
next.config.mjs                 # webpack aliases (stubs optional WalletConnect QR chain)
.env.example                    # env template
src/
  app/
    layout.tsx                  # fonts (Caveat + VT323), metadata, providers
    page.tsx                    # board page (client-only dynamic import)
    globals.css                 # cork texture, dot grid, retro components
  components/
    Providers.tsx               # WagmiProvider + QueryClientProvider
    Header.tsx                  # retro title plate + note counter + chain
    WalletButton.tsx            # Connect Wallet / truncated address / menu
    Board.tsx                   # scrollable cork canvas + drag-to-place ghost
    StickyNote.tsx              # tilt, pin/washi-tape, hover peel, z-index
    NoteComposer.tsx            # 280-char editor, colors, reroll, approve + paid stamp tx
  hooks/useNotes.ts             # paginated reads + live NoteCreated stream
  lib/
    wagmi.ts                    # chains (Base, Base Sepolia), connectors
    contract.ts                 # ABI, payment constants, address from env
    board.ts                    # board constants, palette, helpers, demo notes
```

---

## 3 · Smart contract

`contracts/IMDRetroWall.sol` — ownerless, immutable, no upgradability, **ERC-721**:

```solidity
struct Note {
    uint256 id;
    address author;
    string  content;   // 1..280 bytes
    string  color;     // "#RRGGBB"
    uint16  posX;      // 0..65535 virtual canvas
    uint16  posY;
    int8    rotation;  // -15..15 degrees
    uint256 timestamp;
}

Note[] public allNotes;

function stampNote(string calldata _content, string calldata _color,
                   uint16 _posX, uint16 _posY, int8 _rotation)
                   external payable returns (uint256);
                   // + burn 0.02 FRNPET + forward 0.00005 ETH
                   // + mint ERC-721 + NoteCreated
function getTotalNotes() external view returns (uint256);
function getNotes(uint256 offset, uint256 limit) external view returns (Note[] memory);
function getNote(uint256 id) external view returns (Note memory);
function tokenURI(uint256 tokenId) public view returns (string memory); // on-chain JSON
```

**Note-as-an-NFT**: `stampNote` mints a unique ERC-721 (`IMDNOTE`) token to `msg.sender`,
with the token id equal to the note id. `tokenURI` returns an on-chain `data:` JSON
with author, color, position, rotation and timestamp — no off-chain metadata server needed.

L2-optimized: custom errors instead of revert strings, `unchecked` counter loops,
paginated reads so the frontend never pulls the whole array in one `eth_call`, and a
`NoteCreated` event carrying the full payload so listeners render in real time with
zero extra reads.

### Payment (per stamp)

| Constant         | Value | Meaning                                                        |
| ---------------- | ----- | -------------------------------------------------------------- |
| `PAYMENT_TOKEN`  | `0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105` | FRNPET ERC-20 on Base mainnet (18 decimals) |
| `TOKEN_FEE`      | `0.02 FRNPET` (`2e16`) | Pulled via `transferFrom`, sent straight to `TOKEN_BURN` — destroyed in the same transfer; the wall never holds a balance |
| `TOKEN_BURN`     | `0x0000…dEaD` | The dead address the token fee is burned to             |
| `ETH_FEE`        | `0.00005 ETH` (`5e13` wei) | Exact `msg.value` required; forwarded to `ETH_RECIPIENT` |
| `ETH_RECIPIENT`  | `0x8d5Ba1fc60fe4d6FB41ED2176f3f2E05FEBC0cA5` | Fixed, hardcoded recipient of the ETH fee        |

Both payments are **mandatory and atomic**: wrong `msg.value` → `IncorrectEthFee`;
missing allowance/balance → ERC-20 revert surfaced as `TokenTransferFailed` path;
failed ETH forward → `EthTransferFailed`. All constants are hard `constant`s —
changing them requires deploying a new contract (that is the point: no admin, no owner).

### ETH distribution — top 3 stampers

Every stamp forwards **0.00005 ETH** to `ETH_RECIPIENT`. That ETH is distributed to the
**top 3 authors who have stamped the most notes** on the wall:

| Rank  | Share |
| ----- | ----- |
| Top 1 | **50%** |
| Top 2 | **30%** |
| Top 3 | **20%** |

The ranking is derived straight from the chain: notes are append-only, so the per-author
stamp count comes from the `NoteCreated` event stream (or `getNotes` pagination) — no
off-chain database needed to compute the leaderboard.

> Distribution of the ETH pool to the top 3 is administered off-chain by the
> `ETH_RECIPIENT` address (e.g. periodic payouts from that address). The contract's only
> on-chain obligation is forwarding the 0.00005 ETH fee per stamp; the 50/30/20 split is
> the project's stated policy, not a contract-enforced transfer.

---

## 4 · Setup — step by step

### 4.1 Install

```bash
npm install
```

### 4.2 Compile & test the contract

```bash
npm run compile     # hardhat compile (artifacts/)
npm test            # hardhat test — validation, events, pagination, payments
```

### 4.3 Deploy

```bash
cp .env.example .env
# fill in:  DEPLOYER_PRIVATE_KEY  (wallet funded with ETH on Base for gas)

npm run deploy:base           # Base mainnet — the real target
```

The script prints the contract address, the deploy tx hash, and the exact
`NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=` line to paste into `.env.local`.

> **Important**: the payment token (FRNPET) exists only on **Base mainnet**. You can
> deploy to `localhost` (with the mock) or Base Sepolia for read-only experiments, but
> `stampNote` will always revert on those networks because `PAYMENT_TOKEN` has no code
> there. The production deployment target is Base mainnet.

### 4.4 Frontend env (`.env.local`)

```bash
NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=0xYourDeployedAddress   # required to go live
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=                      # optional (WalletConnect QR)
```

> Without `NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS` the board runs in **demo mode** with
> sample notes so you can see the design; stamping is disabled.

### 4.5 Run the app

```bash
npm run dev         # http://localhost:3000
npm run build       # production build (also typechecks)
```

> Don't run `npm run build` while `npm run dev` is running — both share `.next/` and
> the dev server's chunks will start 404ing (page stuck at "loading the wall").
> Restart the dev server if that happens.

---

## 5 · How the frontend works

1. **Connect wallet** — `WalletButton` uses wagmi's `useConnect`/`useAccount`;
   connected state shows the truncated address (`0x1234...abcd`) and a disconnect menu.
2. **Place** — the FAB opens *placement mode*: a draggable dashed ghost note appears on
   the cork. Drag it anywhere on the 3200×2200 canvas; the tag under it shows the live
   `X / Y` coordinates that will be written on-chain.
3. **Compose** — clicking the ghost opens the retro modal: 280-char counter, six pastel
   swatches, a reroll-able tilt (−15°…+15°), and a live paper preview.
4. **Stamp (two steps the first time)** — *Stamp Permanently On-Chain* first asks for a
   one-time **unlimited FRNPET approval** (step 1/2), then sends `stampNote` with
   `value: 0.00005 ETH` (step 2/2). The 0.02 FRNPET is burned to the dead address and
   the ETH is forwarded to the recipient inside the same transaction. The note then
   springs onto the wall **and the NFT is minted to your wallet**.
5. **Real-time** — `useNotes` paginates `getNotes(0,50)` / `(50,50)`… for history and
   subscribes to `NoteCreated`, so stamps from *other* wallets appear instantly too.

### Overlapping & layering rules

- `z-index = 10 + note.id × 2` → newer notes always stack above older ones.
- Hovering lifts a note (`y: -10`, `scale: 1.05`) and drops it to `opacity: 0.85`
  while jumping its z-index to the top — the peel hint that shows paper underneath.
- Clicking a note pins it to the front of the stack.

---

## 6 · Gas & L2 notes

- `stampNote` stores 2 strings + 4 value types, mints an ERC-721, burns 0.02 FRNPET and
  forwards 0.00005 ETH; on Base this is a few cents in gas at normal congestion.
- The contract is **immutable and ownerless** — there is no pause, no upgrade, no
  admin key, and the ETH recipient is a hardcoded constant. Deploys use
  `evmVersion: paris` so the same bytecode runs cleanly on Base.
- Reads are paginated at 50 notes/call (frontend cap: 40 pages = 2 000 notes, with a
  20 s total-count poll picking up growth beyond that).

---

## 7 · Troubleshooting

| Symptom | Fix |
| --- | --- |
| "CONTRACT NOT SET" banner | Set `NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS` in `.env.local`, restart `npm run dev`. |
| Wallet on wrong chain | Switch the wallet (or the frontend default chain in `src/lib/wagmi.ts`) to Base mainnet. |
| Board stuck at "loading the wall" | Dev server chunks went stale (usually after `next build` ran while `next dev` was up). Restart `npm run dev` and hard-refresh the tab. |
| Stamp reverts `IncorrectEthFee` | The wallet sent the wrong ETH value — the composer always attaches exactly `0.00005 ETH`; retry from the modal. |
| Stamp reverts on the token transfer | Not enough FRNPET balance, or the one-time approval was revoked. Approve again (the modal shows STEP 1/2). |
| Notes don't appear after stamping | The tx may still be pending; the counter polls every 20 s and the event listener fires on inclusion. |
| `getNotes` reverts `PageOutOfBounds` | Frontend offset > total (wall shrank? impossible — append-only). Refetch count. |
