# 📌 Notes To The World

A **decentralized, permanent sticky-note corkboard** for **Robinhood Chain** (mainnet) and **Base Sepolia** (testnet).
Every note is a real on-chain `string` — 280 characters max — pinned to an X/Y spot on a
tactile retro cork wall, **and minted as a unique ERC-721 NFT** to its author.
Notes overlap like real paper: newer notes stack on top, and hovering peels the top note
back to hint at what's buried underneath.

Stamping is **paid on-chain** in the project token: every stamp charges **1000 NOTES**,
of which **500 are burned** and **500 accrue to a weekly reward pool** that is split across
the **top 10 stampers of the week** — enforced atomically in the same transaction.

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
| Smart chain  | **Robinhood Chain** mainnet (+ **Base Sepolia** testnet)          |
| Contract     | Solidity `0.8.20` (optimizer 200, EVM **paris**), **ERC-721**      |
| Payment      | **NOTES** ERC-20 (`0x03b7…6173`): 1000/stamp → 500 burned + 500 to weekly pool |
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
  MockPaymentToken.sol          # minimal ERC-20 used only by tests (wall gets its address in the constructor)
scripts/deploy.ts               # deploy script (prints env hint)
test/IMDRetroWall.ts            # hardhat tests (validation, events, pagination, payments)
hardhat.config.ts               # 0.8.20 / optimizer / Robinhood Chain + Base Sepolia
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
    wagmi.ts                    # chains (Robinhood Chain, Base Sepolia), connectors
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
                   external returns (uint256);
                   // + burn 500 NOTES + accrue 500 NOTES to weeklyRewardPool
                   // + update noteCountPerEpoch + leaderboard
                   // + mint ERC-721 + NoteCreated
function getTotalNotes() external view returns (uint256);
function noteCountPerEpoch(uint256 epoch, address author) external view returns (uint256);
function currentTopMinters(uint256 index) external view returns (address);
function weeklyRewardPool() external view returns (uint256);
function currentEpoch() external view returns (uint256);
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

Stamps are paid **entirely in the project ERC-20** — there is no ETH involved
(`stampNote` is nonpayable):

| Constant                  | Value | Meaning                                                     |
| ------------------------- | ----- | ----------------------------------------------------------- |
| `PAYMENT_TOKEN`           | set in the `constructor` | Any standard ERC-20 (immutable after deploy) — must have code on the chain |
| `TOKEN_FEE`               | `1000 NOTES` (`1000e18`) | Total fee pulled via `transferFrom` (needs a prior `approve`) |
| `TOKEN_FEE_BURN_SHARE`    | `500 NOTES` (`500e18`) | Pulled straight to `TOKEN_BURN` — destroyed in the same transfer |
| `TOKEN_FEE_POOL_SHARE`    | `500 NOTES` (`500e18`) | Pulled into the contract and added to `weeklyRewardPool`   |
| `TOKEN_BURN`              | `0x0000…dEaD` | The dead address the burn share is destroyed at           |

The fee is **mandatory and atomic**: missing allowance/balance → ERC-20 revert surfaced
as the `TokenTransferFailed` path. All constants are hard `constant`s — changing them
requires deploying a new contract (that is the point: no admin, no owner).

### Weekly reward economy — 7-day epochs & top-10 leaderboard

Time is split into **7-day epochs** (`EPOCH_DURATION = 7 days`). Every stamp counts
into the current epoch's per-author tally (`noteCountPerEpoch[epoch][author]`) and keeps
a **live top-10 leaderboard** (`currentTopMinters`) sorted on-the-fly with a bounded
insertion sort (max 10 slots, no off-chain indexer). A tie is broken in favor of whoever
reached that count **first** — the earlier stayer keeps the higher rank.

The **first stamp after an epoch boundary** rolls the epoch over and distributes the
accrued `weeklyRewardPool` to the top 10 by rank:

| Rank      | Share | | Rank      | Share |
| --------- | ----- |-| --------- | ----- |
| 1st       | **30%** | | 5th       | **8%**  |
| 2nd       | **15%** | | 6th       | **8%**  |
| 3rd       | **15%** | | 7th       | **4%**  |
| 4th       | **8%**  | | 8th–10th  | **4%** each |

Empty leaderboard slots are **skipped**; their undistributed share stays in the
contract and **rolls over** into the next epoch's pool. The rollover emits a
`RewardPaid` event per winner plus a single `EpochAdvanced(previousEpoch,
newEpoch, distributed, rolledOverPool)`. Distribution is enforced **entirely
on-chain** — no admin key, no off-chain payout runner.

### Live deployment (Robinhood Chain mainnet, chain 4663)

| Artifact   | Address / hash | Example tx |
| ----------- | -------------- | ---------- |
| Payment token — **NOTES** (ERC-20, 18 decimals) | `0x03b76ccf7cfeec5198c81c5844b88a78e68a6173` | — |
| **IMDRetroWall** (ERC-721 wall, fee = 1000 NOTES) | `0x515F8f72B62e22c957D34Ba87b312133eFcAC939` | deploy tx `0xe611b6eff706a1b2f0235e7c6177e1b5033ecff921dff7ef184b2eeed55958ed` |

Verify on-chain reads straight from RPC: `PAYMENT_TOKEN` should resolve to the
NOTES address and `TOKEN_FEE` to `1000e18`.

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
# fill in:  DEPLOYER_PRIVATE_KEY  (wallet funded with ETH on the target chain for gas)
#           PAYMENT_TOKEN         (your ERC-20 address — deploy the token first)

PAYMENT_TOKEN=0xYourTokenAddress npm run deploy:robinhood      # Robinhood Chain mainnet — the real target
PAYMENT_TOKEN=0xYourTokenAddress npm run deploy:baseSepolia    # Base Sepolia — read-only experiments
```

The script prints the contract address, the deploy tx hash, and the exact
`NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=` / `NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=`
lines to paste into `.env.local`.

> **Important**: the wall takes the payment-token address as a constructor argument
> (`constructor(IERC20 _paymentToken)`) — deploy your ERC-20 first, then the wall. The
> deploy script requires the `PAYMENT_TOKEN` env var and warns if no code exists at that
> address on the target chain — `stampNote` reverts until the token is live. The
> production deployment target is **Robinhood Chain**.

### 4.4 Frontend env (`.env.local`)

```bash
NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS=0xYourDeployedAddress   # required to go live
NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS=0xYourTokenAddress       # required to go live
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
   one-time **unlimited NOTES approval** (step 1/2), then sends the nonpayable
   `stampNote` (step 2/2). The contract pulls the **1000 NOTES** fee, burns 500 to the
   dead address and adds 500 to the weekly pool, and (on the first stamp after a 7-day
   boundary) settles the previous epoch's top-10 rewards. The note then springs onto
   the wall **and the NFT is minted to your wallet**.
5. **Real-time** — `useNotes` paginates `getNotes(0,50)` / `(50,50)`… for history and
   subscribes to `NoteCreated`, so stamps from *other* wallets appear instantly too.

### Overlapping & layering rules

- `z-index = 10 + note.id × 2` → newer notes always stack above older ones.
- Hovering lifts a note (`y: -10`, `scale: 1.05`) and drops it to `opacity: 0.85`
  while jumping its z-index to the top — the peel hint that shows paper underneath.
- Clicking a note pins it to the front of the stack.

---

## 6 · Gas & L2 notes

- `stampNote` stores 2 strings + 4 value types, updates the epoch counter + leaderboard,
  mints an ERC-721, and pulls the 1000 NOTES fee (500 burned / 500 to pool); on these L2s
  this is a few cents in gas at normal congestion.
- The contract is **immutable and ownerless** — there is no pause, no upgrade, no admin
  key, and the epoch/leaderboard/reward split are hardcoded constants. Deploys use
  `evmVersion: paris` so the same bytecode runs cleanly on Robinhood Chain and Base Sepolia.
- Reads are paginated at 50 notes/call (frontend cap: 40 pages = 2 000 notes, with a
  20 s total-count poll picking up growth beyond that).

---

## 7 · Troubleshooting

| Symptom | Fix |
| --- | --- |
| "CONTRACT NOT SET" banner | Set `NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS` in `.env.local`, restart `npm run dev`. |
| Wallet on wrong chain | Switch the wallet (or the frontend default chain in `src/lib/wagmi.ts`) to Robinhood Chain. |
| Board stuck at "loading the wall" | Dev server chunks went stale (usually after `next build` ran while `next dev` was up). Restart `npm run dev` and hard-refresh the tab. |
| Stamp reverts on the token transfer | Not enough NOTES balance (< 1000), or the one-time approval was revoked. Approve again (the modal shows STEP 1/2). |
| Stamp reverts sending ETH | `stampNote` is nonpayable — do not attach ETH. The fee is 1000 NOTES, pulled via `transferFrom`. |
| Notes don't appear after stamping | The tx may still be pending; the counter polls every 20 s and the event listener fires on inclusion. |
| `getNotes` reverts `PageOutOfBounds` | Frontend offset > total (wall shrank? impossible — append-only). Refetch count. |
