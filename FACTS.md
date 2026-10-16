# FACTS.md — internal (jangan dipublikasikan)

Sumber setiap fakta dicantumkan (file:line, alamat on-chain, atau tx hash). Tidak ada yang ditebak.
Dibuat 2026-10-16; status live dibaca via RPC publik Robinhood (`rpc.mainnet.chain.robinhood.com`,
`4663.rpc.thirdweb.com`) dan Base (`mainnet.base.org`) — semua panggilan read-only, tanpa transaksi.

## 1 · Kontrak kita + wiring (dibaca balik on-chain)

> ⚠️ **2026-10-16: §1/§1a di bawah adalah RECORD HISTORIS pasangan produksi LAMA
> (`0xbD4808f0…2110`, kini superseded — relay-nya tanpa ERC-165 dan tidak akan pernah
> men-settle). Pasangan produksi AKTIF ada di §1b.**

## 1b · Pasangan produksi AKTIF — redeploy 2026-10-16 (semua dibaca balik on-chain)

Live app: TODO — add the deployed frontend URL here (mirrors ENTRY.md).

| Item | Nilai | Sumber |
| --- | --- | --- |
| Wall v3 aktif (ERC-721) | Robinhood 4663: `0x9550E4F888d1C084CB1C8E74677Da54109723EE3` | `scripts/status.ts` (konst baru); `eth_call relay()` |
| Tx penciptaan wall | `0x96a95bb3593ddd496aa818960dc3b39e01b2118c2168691c9deb0504fd87dc7a`, block 89.795.280, status 1 | `eth_getTransactionReceipt` → `contractAddress = 0x9550E4F8…3EE3` |
| Relay aktif | Base 8453: `0x887bbed753938087Ce61Ca768a358848177E6eaA` | `scripts/status.ts` |
| Tx penciptaan relay | `0x20c3ac0a0a55e25f9c53a14a9ce85c9c45f1c511f250892d72e036daa84a37a2`, Base block 52.668.264, nonce 31, status 1 (scan blok antara tx fund-sub `0x000a34c7…` dan tx addConsumer `0x064d4d04…`) |
| Tx VRF sub | create `0x2836ec8ecbbe58aa82aaccaa56502ba160b0359f87ee228519925a40624522cf` (block 52.668.260) · fund `0x000a34c7b67f24c3c03b39627e471be6d829ba347f138f3552029af18a5c48bd` (block 52.668.262) · addConsumer `0x064d4d041a0bfc40be25cf4fc898180cca17e331960272ee254f8fa089b6dec2` (block 52.668.266) · fund relay `0x15c0c2f710fe101f32c523b3e0ffa482d1bfec47510969689736da3f27278733` (block 52.668.268) | log `scripts/deploy-relay.ts` `/tmp/deploy-relay-prod2.log` + nonce/block via RPC |
| `setRelay` (satu kali) | `0x3b7bb3b490bbd12fc48496fca55c60b1455a4646f0df5f3af39bd11a2828b928` (status 1) | log `scripts/set-relay.ts` `/tmp/setrelay-prod2.log` |
| Wiring dua arah | `wall.relay() = 0x887bbed7…6eaA` DAN `relay.WALL() = 0x9550E4F8…3EE3` | `/tmp/verify-pair4.js` (RPC) |
| GENESIS / epoch | `1792124930` = 2026-10-16 04:28:50 UTC; `EPOCH_DURATION = 3 days`; **epoch 1 berakhir 2026-10-19 04:28:50 UTC** | `wall.GENESIS()`, `wall.EPOCH_DURATION()` |
| ERC-165 relay | `supportsInterface(0x85572ffb) = true` (IAny2EVMMessageReceiver v1 5-field), `0xffffffff = false` (balik false, tak revert), bytecode mengandung `01ffc9a7` | `/tmp/probe-iface.js` |
| Bytecode equality | wall 19.431 B: semua diff di 16 window immutable (5 immutable); relay 4.073 B: semua diff di 18 window zero (6 immutable); setiap window = nilai konstruktor yang diharapkan → **patched == live, 0 byte diff sisa** | `/tmp/verify-wall2.js`, `/tmp/relay-verify-final.js` |
| VRF sub (aktif) | `51441836222580451052993458818119349024779142164800689033215217746100047214776`; native 0.0008 ETH; reqCount 0; owner = wallet kita; consumer = relay (satu-satunya) | `getSubscription` coordinator `0xd5D517aB…` |
| Relay ETH (Base) | 0.0005 ETH | `eth_getBalance` |
| Key hash | 2 gwei `0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab` | `relay.KEY_HASH()`; cocok nilai deploy |
| **Status VRF/settlement live (dibaca 2026-10-16 ~07:10 UTC)** | epoch 1: 1 tiket (deployer), pool 500 NOTES, `settlementStatus(1)=None`; relay `randomnessReady(1)=false`, `delivered(1)=false`; VRF sub 0.0008 ETH `reqCount=0` consumer = relay saja; relay ETH 0.0005. `requestSettlement(1)` produksi baru BISA dikirim setelah epoch 1 berakhir **2026-10-19 04:28:50 UTC**; skrip `settle-prod.ts` mengirim SEKALI saja, lalu `deliver(1)` di Base saat word ready (tidak pernah re-request saat pending) | `/tmp/onchain-status.js` + `/tmp/settle-prod-dryrun.log` (SETTLE_DRY_RUN=1, tanpa transaksi) |
| **Status verifikasi explorer (2026-10-16 07:13 UTC)** | Basescan masih menampilkan relay produksi `Contract: Unverified`; halaman RobinScan tidak terbaca mesin dari host ini — anggap kedua page belum diverifikasi sampai upload Standard-JSON selesai; file input `verification/*.json` sudah ter-commit dan terbukti byte-sama dengan bytecode live | read_url Basescan + `verification/` |
| **Audit (pasangan produksi)** | Commit `a5c1af9fc13c8413b508b245a997fdfc2689fa81` diaudit 2026-10-16: **2 medium / 5 low / 2 info** — https://github.com/Identity-md/research/blob/main/jobs/44df6543-f9d6-4f44-9d69-40e0f7223b0c/files/AUDIT.md — 9 temuan semuanya *acknowledged, not fixed in the deployed contracts* dengan mitigasi operasional (lihat README §10); audit lama d063100 tetap sebagai riwayat | AUDIT.md |

Input verifikasi explorer (Standard-JSON, solc 0.8.20, optimizer 200, evmVersion paris):
`verification/wall-standard-json-input.json` (RobinScan, IMDRetroWall),
`verification/relay-standard-json-input.json` (Basescan, VrfCcipRelay). Kedua input
sudah dibuktikan meng-compile persis ke bytecode yang terpasang (relay: build-info
345e5aa4 == artifact == live; wall: build-info 0eba06a8 == artifact == live modulo
immutable-nya).

### 1a · Deployer (terverifikasi on-chain 2026-10-16, via receipt + Basescan/RobinScan)

| Item | Nilai | Sumber |
| --- | --- | --- |
| Wallet kita (deployer wall + relay) | `0x380fbF99A903253E14b9EB797807B4B92cd4b019` | Deployer di semua log deploy lokal (`/tmp/deploywall2-4.log`); RobinScan wallet page (holds 19,995,000 NOTES, did `setRelay`, approvals, `stampNote`) |
| Wall produksi v3: tx penciptaan | `0x8b0c13f3f7b91b193916c6badcd9f2fb5c6f9b85285156b1d52f9d39838561b9` (block 89423095) | `eth_getTransactionReceipt` → `contractAddress = 0xbD4808f0…2110` (verified 2026-10-16) |
| Wall v1 / v2 (superseded): tx penciptaan | `0xe611b6eff706a1b2f0235e7c6177e1b5033ecff921dff7ef184b2eeed55958ed` → `0x515F8f72…C939`; `0xed191ec9851a45139ecd5e1026388bf02189bfe64b9c7a26ec28f3401dab8644` → `0x69A8143e…0BbE` | receipt `contractAddress`; wallet nonces 0/1 (Robinhood) |
| Relay produksi (Base) | tx penciptaan `0x01d68c8bb8078aba83702a3496625f7420c2ddff65fcd9d7651b676a81469466` (Base block 52649007) | `eth_getTransactionReceipt` (Base) → `contractAddress = 0xbD4808f0…2110`, status 1, from = wallet kita — re-verified; Basescan "ContractCreator 0x380fbF99…" |
| Relay: setelah deploy (Base) | funding tx `0xe5e4e60e16f5c124f0bc4b6ad54f53788bb35c8b0d18c94d68a7cfaa6824b562` (block 52649011) | Basescan wall-relay tx list |
| NOTES deployer | **IMD**: token dibuat **internal** oleh factory launch `0x9C9D2FCB75c2C132c0ac0c42df3819a42347265e` di dalam tx launch `0x874397f3…` (RobinScan "Parent Tx / internal tx: From 0x9C9D2FCB → Contract Creation"); tx DITANDA oleh EOA IMD `0xcECc29B037f5064fcdf45a5c318f132ef76aa551` (RobinScan "ContractCreator") | RobinScan page NOTES (internal tx) + `eth_getTransactionByHash` (from 0xcECc29B0…, to 0x9C9D2F…) |
| Implikasi Radar | Radar membayar prize ke **deployer kontrak yang di-entry**: entry harus WALL (deployer wallet kita) — bukan NOTES (deployer-nya IMD) |ация di atas + aturan form imdradar.site/hackathon |

| Item | Nilai | Sumber |
| --- | --- | --- |
| Wall `IMDRetroWall v3` (ERC-721) | Robinhood Chain (4663): `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` | `scripts/status.ts` output; RobinScan: robin.etherscan.io/address/0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110 |
| Relay `VrfCcipRelay` | Base (8453): `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` | `scripts/status.ts`; Basescan: basescan.org/address/0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110 |
| `wall.relay()` | `0xbD4808f0B262C9abaBB886fbC64c4DcCf22e2110` | `scripts/status.ts` baca langsung (setRelay satu kali: `contracts/IMDRetroWall.sol:298-303`) |
| `wall.CCIP_ROUTER()` | `0x06fC836cf9839B1cd891C440A0a45242DA6Ae1c9` (Robinhood) | `scripts/status.ts`; konstanta `scripts/deploy.ts` |
| `wall.RELAY_CHAIN_SELECTOR()` | `15971525489660198786` (Base) | `scripts/status.ts` |
| `relay.WALL()` / selector / router | `0xbD4808f0…2110` / `6180753054346818345` / `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` | `scripts/status.ts` |
| VRF coordinator (Base) | `0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634` | contracts/VrfCcipRelay.sol:39-40 tidak hardcoded; dipakai `scripts/deploy-relay.ts` dan `scripts/status.ts` |
| VRF key hash (production relay) | 2 gwei: `0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab` | `scripts/status.ts` (`relay.KEY_HASH()`) |
| VRF sub (production relay) | `111091676028145456194730985957046828060160361214923180334213817157620972393256`, saldo native 0.0002 ETH | `scripts/status.ts` (`relay.SUBSCRIPTION_ID()`, `getSubscription`) |
| Dua alamat identik di dua chain | Kebetulan CREATE (deployer + nonce sama), bukan kontrak yang berbagi state | `scripts/status.ts`; README §3 |

Relay uji (untuk bukti jalur live, pasangan berbeda):
- Relay uji #3 Base `0xcCEB1364EF25A384c62054AFe3C2845B8F37766E`, keyHash 30 gwei
  (`0xdc2f87677b01473c763cb0aee938ed3341512f6057324a584e5944e786144d70`), sub
  `55401489840556673613819228627691859165464877435836030725487536891931176079128`
  (deploy tx /tmp/deployrelay4.log; sub-Id dari `VRF_SUB_ID` env).
- Wall uji 10-menit Robinhood `0x309DF01E9D2Cf21A062739A6D298251D6a6A9b3F` (deploy tx `0xb8f117865d3b11f2700d542aa7112bc7aad3b57e679923afc9b78079b0d657ec`).
- Pas wall uji ⇄ relay uji: tx setRelay `0x55e4072f3d179afcd26165cad4508d02ab77944dd29be089238fb6548973fdd4` (status 1, Robinhood block ±89.59M).

## 2 · NOTES token (paired, bukan kode buatan kita)

| Item | Nilai | Sumber |
| --- | --- | --- |
| NOTES ERC-20 | Robinhood (4663): `0x03b76ccf7cfeec5198c81c5844b88a78e68a6173` | `scripts/status.ts` (`wall.PAYMENT_TOKEN()`, `relay`-versinya `scripts/status.ts` juga) + RobinScan token page |
| Nama/simbol/decimals | "NOTES / NOTES / 18" | RPC `name()`,`symbol()`; RobinScan: Contract Name `NOTES`, "WITH 18 Decimals" |
| Supply | 1.000.000.000 (10^27 base), dicetak sekali ke deployer di constructor | RobinScan: `INITIAL_SUPPLY`, Max Supply; launch repo README (§refs) |
| Owner/mint/freeze | Tidak ada (plain ERC-20, OZ v5.0.2 subset); constructor tanpa pemanggilan external | RobinScan: "Source Code Verified Exact Match", ABI tanpa fungsi admin; launch repo: "no callable mint or burn function" |
| Paired currency | **IMD (`Identity.md`)**: `0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127` (18 dec) | RPC `name()/symbol()/decimals()` = "Identity.md / IMD / 18"; launch repo: "Pair currency: IMD at 0x5f7bb593…7127" |
| MerkleDistributor (10% agents) | `0xd89c2f7745d28c9c5e5466781c5a14be1f4fe9f3` (ada kode, 4145 byte) | launch event (log 2/9) + `eth_getCode` |
| Saldo sekarang (read-only 2026-10-16) | PoolManager: 879.999.999,9999… NOTES (≈88%); Distributor: 99.821.627,64 NOTES; Wall: 500; deployer 0x380f…: 19.995.000 | `eth_call balanceOf` di 0x8366…, 0xd89c…, 0xbD4808…, 0x380f… |

## 3 · Pool Uniswap V4 dan hook launch

| Item | Nilai | Sumber |
| --- | --- | --- |
| PoolManager (IMD launch infra, bukan Uniswap-kanonik) | Robinhood: `0x8366a39CC670B4001A1121B8F6A443A643e40951` (kode 24.009 byte) | hook `poolManager()` via RPC; kontrak diverifikasi di RobinScan |
| Hook | `PoolInitializationGuard` di `0x19Bec7C2E1b2aadAf67b259744751a9960d66000`, verified exact match (Sol 0.8.26) | RobinScan page hook |
| Hook: perilaku | Hanya `beforeInitialize(sender, PoolKey, uint160)`; revert `NotFactoryInitialization` bila punya pemanggil yang berada di luar factory launch (0x9C9D2FCB…265e); tanpa fee/take; tanpa swap/addLiquidity hooks | RobinScan ABI (daftar fungsi) + bytecode dekomp; `factory()`/`poolManager()` dibaca via RPC |
| Hook: dibuat | 9 hari lalu, block 81.288.404, tx pembuat `0x3222c9775dc6c673b8ebe612e8650cf000fbfc19be299d0e5bef20068b7a3dba` oleh deployer hook 0x047F606f…CB6B054B7 | RobinScan "ContractCreator / Parent Transaction" |
| Pool NOTES/IMD | Uniswap **V4**, fee 12.500 (1,25%), tickSpacing 60, hook=guard; TIDAK hook fee (hook klaim 0 fee) | Event `Initialize` di launch tx (log 3): `fee=0x30d4`, `tickSpacing=0x3c`, `hook=0x19bec…` |
| poolId | `0x27c60c8dcaf32a6bc17e1d54e9eddf194d5d5319adbacf2ebb89023be1e95b80` | topic1 event `Initialize` (log 3) — persis sama dengan `keccak256(abi.encode(NOTES, IMD, 12500, 60, 0x19bec…))` yang kita hitung |
| Tx initialize pool + seeding | `0x874397f3de80109a73ca8bae153efb7a9005cb73f8c271055f679b455fdc55f2` (block 89.350.492, status 1) — berisi: mint 1B→factory, event distributor, `Initialize` pool, transfer 880.000.000 NOTES→PM, event factory `0x741a1c2d4c…` | `eth_getTransactionReceipt` (log 0..9) |
| Launch repo | github.com/identity-md-launches/launch-1866-notes | halaman README launch repo |
| Launch event (factory `0x741a1c2d4c…`) pada tx yang sama | topic1 ke ID launch 0x074a (=1866 desimal), topic2 = NOTES | log 9 dari receipt tx launch |

Hook **bukan buatan kita**; itu launch-hook milik IMD. Jangan pernah menyebutnya sebagai kontrak custom NTTW.

## 4 · Ekonomi (dari kode, bukan README)

- Fee/stamp 1000 NOTES: `contracts/IMDRetroWall.sol:118` (`TOKEN_FEE = 1000e18`).
- Burn/pool 500/500: `IMDRetroWall.sol:121,124` (`TOKEN_FEE_BURN_SHARE`, `TOKEN_FEE_POOL_SHARE`), dipasok di `:355-356` (safeTransferFrom ke `TOKEN_BURN` dEaD + wall).
- MAX_STAMPS_PER_EPOCH=5: `IMDRetroWall.sol:137`; cek di `:341` (post-fee cap-core stamp per address per epoch).
- Epoch 3 hari, GENESIS-based: `IMDRetroWall.sol:134` (**deployed constant `EPOCH_DURATION = 3 days` = 259200 s**; audit #7 — NatSpec/header di file sumber masih menyebut "7 days", tetapi konstanta ter-deploy adalah 3 hari; sumber kebenaran = baca on-chain), GENESIS `:184`, `currentEpoch()` `:462-465` = `(block.timestamp-GENESIS)/EPOCH_DURATION + 1`.
- Tiket: `stampsInEpoch[epoch][msg.sender]` & `_tickets[epoch].push(msg.sender)` `:333-345` — uniform random.
- Winner: `randomWord % ticketCount` di `ccipReceive`: `IMDRetroWall.sol:415,437` dan kata `:232` (`WinnerDrawn` menyimpan `randomWord`).
- Hadiah: `epochPrize[epoch]` penuh → `claimable[winner] += prize` `:439-442`, di-klaim sendiri via `claimReward()` `:446-451`.
- requestSettlement payable by anyone: `:369-399` — `msg.value >= fee` (InsufficientFee di `:399`);

## 5 · Tests & typecheck (aktual, 2026-10-16)

- `TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat test` → **22 passing**, exit 0 (log `test-entry.log`).
- `TS_NODE_PROJECT=tsconfig.hardhat.json npx tsc -p tsconfig.hardhat.json --noEmit` → exit 0.
- `npx tsc --noEmit` (frontend/config) → exit 0.

## 6 · Live status (VRF→CCIP→WinnerDrawn) — persis sekarang

- CCIP wall→relay: **terverifikasi live** di pasangan uji `0x309DF01E… ⇄ 0xcCEB1364…`: requestSettlement tx
  `0x1752fa15d11007ad4bcf536ad19d1734783101454990566ff8edded56aaba163` (Robinhood block 89.603.093)
  → CCIP SUCCESS (message `0xcf3402a98645…f3609cd15`) → on-chain trace menunjukkan ERC-165 probes +
  `ccipReceive` di relay → `RandomnessRequested` (event tx `0x6d8db81286be…9885aab9`).
- Proyeksi produksi wall `0xbD4808f0… ⇄ relay 0xbD4808f0…`: relay produksi sudah minta VRF
  (2 gwei lane) dan menunggu. requestSettlement produksi belum ada di epoch ini; kita menulis "wall pair
  belum rate-settlement sudah eksis" - jangan mengklaim.
- VRF fulfillment masalah: **belum di-fulfill** oleh Chainlink (±2 jam). Uji isolasi (fresh sub, EOA,
  ExtraArgsV1 bertag, kopling tiap lane, kloning request siap) menganggap kendala ada di seleksi
  request-finegranular Chainlink; bukan di sub kita (data lengkap di README §6.result dan /tmp/settle6-monitor.log).
- Victory: monitor berjalan di background memantau requestSettlement lama.
- Epoch prize terakhir ter-claim apa pun tidak pernah ada belum (tak ada `WinnerDrawn` di mainnet) — jadi
  jangan klaim jalur end-to-end `WinnerDrawn` mujuntak.

## 7 · Audit: peta 14 temuan (d063100) vs v3

Dokumen sumber: github.com/Identity-md/research/blob/main/jobs/16c65a39-24f4-47d6-a9f5-2140c70791c6/files/AUDIT.md

| # | Temuan | Status di v3 | Buktia |
| --- | --- | --- | --- |
| 1 | push-loop payout membahbaya stampNote jika satu transfer gagal (top-10 leaderboard) | FIXED (desain dihapus) | leaderboard dihapus; sekarang `claimable[winner] += prize` + `claimReward()` pull-based: `IMDRetroWall.sol:439-451` |
| 2 | tokenURI data: URI tanpa encode ('#' memotong JSON) | FIXED | `data:application/json;base64,` + `Base64.encode` set `:566`, import Base64 `:9` |
| 3 | settlement hanya di dalam stampNote berbayar (poolx p-s 409) | FIXED / redesigned | `requestSettlement(uint256 epoch)` payable siapa-pun `:369-399`; ccipReceive menulis `WinnerDrawn` `:417-442` |
| 4 | getNotes panic offset+limit | FIXED | `end = limit > total - offset ? total : offset + limit;` `:502` |
| 5 | sybil last-second ambil 100% pool (top-10 board) | FIXED (board dihapus) | tak ada lagi papan rank; hanya tiket uniform + VRF `:333-345,437` |
| 6 | warna `0xRRGGBB` diterima | FIXED | `_isValidHexColor` tegas 7-byte `#RRGGBB` `:682-697` |
| 7 | Komposer hitung UTF-16, kontrak hitung UTF-8 | FIXED | `src/components/NoteComposer.tsx:97-98` pakai `TextEncoder().encode();` + label "BYTES" |
| 8 | Tidak ada validasi UTF-8 | FIXED | `_isValidUtf8` RFC 3629 `:699-751`, dipanggil `:334` |
| 9 | OZ tak dideklarasi di package.json | FIXED | `package.json:31` `"@openzeppelin/contracts": "5.0.2"`; lockfile ada (OZ dipakai di deploy) |
| 10 | Lazy rollover (epoch bergeser) | FIXED | waktu epoch didasarkan GENESIS `:184,462-465` |
| 11 | NatSpec feesh 50 token (konst 500) | FIXED | NatSpec match: `:117-124` (rugositas: `:117 "1000 tokens"`, `:121 "500e18"`…) |
| 12 | Token yang dikirim langsung ke wall acacha (tak ada sweep) | STILL OPEN/by design | grep `sweep|syncPool` = 0 fungsi; di README §5 |
| 13 | Test "reverts the whole stamp..." tak menguji jalur gagal | N/A | push-loop yang diuji sudah tidak ada; test terkait reward transfer tidak ada lagi (`grep RewardTransferFailed` di test = 0) |
| 14 | Tidak ada cek decimals()==18 | FIXED | `InvalidTokenDecimals` di constructor `:284-285` |

Catatan: **v3 belum di-audit ulang.** Temuan findings 1,2,5,3 terlihat sebagai desain yang diubah total, tapi itu OUR klaim hasil inspection, bukan hasil audit baru.

## 8 · (Bagian terpisah) NEED FROM JO

Lihat daftar di bawah file ENTRY.md — item yang tidak bisa dibuktikan dari repo/on-chain.

## 9 · Rujukan explorers

- RobinScan: robin.etherscan.io (chain 4663)
- Basescan: basescan.org (chain 8453)
- Uniswap docs deployments tidak mencantumkan 4663; alamat PM/hook/launch factories semua dibaca on-chain.
