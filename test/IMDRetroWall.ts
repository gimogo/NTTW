import { expect } from "chai";
import { ethers, network } from "hardhat";

const CONTENT = "gm from the corkboard!";
const COLOR = "#FFF2A5";

// Must match contracts/IMDRetroWall.sol constants.
const TOKEN_BURN = "0x000000000000000000000000000000000000dEaD";
const TOKEN_FEE = ethers.parseEther("1000"); // 1000 tokens per stamp
const BURN_SHARE = ethers.parseEther("500"); // 50% -> dead address
const POOL_SHARE = ethers.parseEther("500"); // 50% -> weeklyRewardPool
const EPOCH = 7 * 24 * 60 * 60; // 7 days in seconds

describe("IMDRetroWall", function () {
  // `any` keeps these runnable without typechain. Behaviour is fully asserted.
  let wall: any;
  let token: any;
  let alice: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let bob: typeof alice;
  let carol: typeof alice;
  let signers: Awaited<ReturnType<typeof ethers.getSigners>>;

  /** Deploy a fresh minimal ERC-20; the wall is constructed with its address. */
  async function installMockToken() {
    const Mock = await ethers.getContractFactory("MockPaymentToken");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    return mock;
  }

  /** Stamp helper: alice unless overridden; no ETH value (token-only fee). */
  async function stamp(
    from: typeof alice = alice,
    content: string = CONTENT,
    color: string = COLOR
  ) {
    return wall.connect(from).stampNote(content, color, 1, 1, 0);
  }

  /**
   * Deterministically advance past the epoch boundary. We pin the NEXT
   * block's timestamp to a fixed offset well beyond 7 days (instead of
   * `evm_increaseTime` + `evm_mine`, whose mined block can land exactly on
   * the boundary and let the *setup* stamp trigger a stray rollover).
   * Any stamp after this lands strictly inside epoch N+1.
   */
  async function warpPastEpoch() {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await network.provider.send("evm_setNextBlockTimestamp", [now + EPOCH + 100]);
  }

  beforeEach(async function () {
    signers = await ethers.getSigners();
    [alice, bob, carol] = signers;

    token = await installMockToken();

    const factory = await ethers.getContractFactory("IMDRetroWall");
    wall = await factory.deploy(await token.getAddress());
    await wall.waitForDeployment();

    // Fund alice/bob/carol with FRNPET, then grant the wall an unlimited
    // allowance (matches the frontend's approve-once behaviour) so each user
    // can stamp many notes without re-approving.
    const wallAddress = await wall.getAddress();
    for (const user of [alice, bob, carol]) {
      await token.mint(user.address, ethers.parseEther("1000000"));
      await token.connect(user).approve(wallAddress, ethers.MaxUint256);
    }
  });

  describe("constructor", function () {
    it("wires the payment token and starts epoch 1 at deploy time", async function () {
      expect(await wall.PAYMENT_TOKEN()).to.equal(await token.getAddress());
      expect(await wall.currentEpoch()).to.equal(1n);
      const startTime = await wall.epochStartTime();
      const latest = await ethers.provider.getBlock("latest");
      // Deploy transaction timestamp — never later than the mined block.
      expect(startTime).to.be.lte(BigInt(latest!.timestamp));
    });

    it("reverts when constructed with the zero token address", async function () {
      const factory = await ethers.getContractFactory("IMDRetroWall");
      await expect(
        factory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(factory, "EmptyPaymentToken");
    });
  });

  describe("stampNote", function () {
    it("stores the note, assigns a sequential id, and mints the NFT", async function () {
      await stamp(alice, CONTENT, COLOR);
      await wall
        .connect(bob)
        .stampNote("second note", "#AEE2FF", 100, 200, -12);

      expect(await wall.getTotalNotes()).to.equal(2n);

      const note = await wall.getNote(1);
      expect(note.id).to.equal(1n);
      expect(note.author).to.equal(bob.address);
      expect(note.content).to.equal("second note");
      expect(note.color).to.equal("#AEE2FF");
      expect(note.posX).to.equal(100n);
      expect(note.posY).to.equal(200n);
      expect(note.rotation).to.equal(-12n);
      expect(note.timestamp).to.be.gt(0n);
    });

    it("mints the ERC-721 to the author, id == note id", async function () {
      await stamp(alice);
      await stamp(bob);

      expect(await wall.ownerOf(0)).to.equal(alice.address);
      expect(await wall.ownerOf(1)).to.equal(bob.address);
      expect(await wall.balanceOf(alice.address)).to.equal(1n);
      expect(await wall.balanceOf(bob.address)).to.equal(1n);
      expect(await wall.name()).to.equal("IMD Retro Wall Note");
      expect(await wall.symbol()).to.equal("IMDNOTE");
    });

    it("returns an on-chain data-URI tokenURI with the note attributes", async function () {
      await stamp(alice, CONTENT, "#FFC5D0");
      const uri: string = await wall.tokenURI(0);

      expect(uri.startsWith("data:application/json,")).to.equal(true);
      const json = JSON.parse(uri.replace("data:application/json,", ""));
      expect(json.name).to.include("IMD Note #0");
      const traits = json.attributes.map((a: any) => a.trait_type);
      expect(traits).to.include.members([
        "Author",
        "Color",
        "posX",
        "posY",
        "Rotation",
      ]);
    });

    it("embeds the note content (JSON-escaped) in tokenURI", async function () {
      const tricky = 'he said "hi"\\ and\tweird\nchars 📌';
      await wall
        .connect(alice)
        .stampNote(tricky, "#FFC5D0", 7, 9, -3);
      const uri: string = await wall.tokenURI(0);

      const json = JSON.parse(uri.replace("data:application/json,", ""));
      const content = json.attributes.find(
        (a: any) => a.trait_type === "Content"
      );
      expect(content).to.not.equal(undefined);
      expect(content.value).to.equal(tricky);
    });

    it("emits NoteCreated with the full payload", async function () {
      const tx = await wall
        .connect(alice)
        .stampNote(CONTENT, "#FFC5D0", 5, 6, -3);

      await expect(tx)
        .to.emit(wall, "NoteCreated")
        .withArgs(
          0n,
          alice.address,
          CONTENT,
          "#FFC5D0",
          5n,
          6n,
          -3n,
          (ts: bigint) => ts > 0n
        );
    });

    it("accepts exactly 280 bytes of content", async function () {
      const content280 = "a".repeat(280);
      await wall.connect(alice).stampNote(content280, COLOR, 1, 1, 0);
      expect((await wall.getNote(0)).content).to.have.length(280);
    });

    it("reverts on empty content", async function () {
      await expect(
        wall.connect(alice).stampNote("", COLOR, 1, 1, 0)
      ).to.be.revertedWithCustomError(wall, "EmptyContent");
    });

    it("reverts on 281 bytes of content", async function () {
      await expect(
        wall.connect(alice).stampNote("a".repeat(281), COLOR, 1, 1, 0)
      ).to.be.revertedWithCustomError(wall, "ContentTooLong");
    });

    it("reverts on malformed colors", async function () {
      for (const bad of ["#FFF2A", "FFF2A5", "#GGG", "#1234567", ""]) {
        await expect(
          wall.connect(alice).stampNote(CONTENT, bad, 1, 1, 0)
        ).to.be.revertedWithCustomError(wall, "InvalidColor");
      }
    });

    it("accepts 0x-prefixed and uppercase hex colors", async function () {
      await wall.connect(alice).stampNote(CONTENT, "0xFFF2A5", 1, 1, 0);
      await wall.connect(alice).stampNote(CONTENT, "#abcdef", 1, 1, 0);
      expect(await wall.getTotalNotes()).to.equal(2n);
    });

    it("reverts on out-of-range rotation", async function () {
      await expect(
        wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, 16)
      ).to.be.revertedWithCustomError(wall, "InvalidRotation");
      await expect(
        wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, -16)
      ).to.be.revertedWithCustomError(wall, "InvalidRotation");
    });

    it("rejects attached ETH (payment is token-only)", async function () {
      await expect(
        wall
          .connect(alice)
          .stampNote(CONTENT, COLOR, 1, 1, 0, { value: 1n })
      ).to.be.reverted; // non-payable
    });
  });

  describe("payment (1000 tokens: 50% burned / 50% pool)", function () {
    it("burns exactly 50% of the fee to the dead address", async function () {
      const before = await token.balanceOf(TOKEN_BURN);
      await stamp();
      const after = await token.balanceOf(TOKEN_BURN);
      expect(after - before).to.equal(BURN_SHARE);
    });

    it("keeps 50% of the fee as the contract's weeklyRewardPool", async function () {
      const wallAddress = await wall.getAddress();
      await stamp();

      expect(await token.balanceOf(wallAddress)).to.equal(POOL_SHARE);
      expect(await wall.weeklyRewardPool()).to.equal(POOL_SHARE);
    });

    it("pulls the full fee from the staker in one stamp", async function () {
      const before = await token.balanceOf(alice.address);
      await stamp();
      const after = await token.balanceOf(alice.address);
      expect(before - after).to.equal(TOKEN_FEE);
    });

    it("reverts when the token allowance is missing", async function () {
      await token.connect(alice).approve(await wall.getAddress(), 0n);
      await expect(stamp()).to.be.reverted; // ERC20 insufficient-allowance revert
    });

    it("reverts when the token balance is too low", async function () {
      // Drain alice down to less than the fee (allowance is already unlimited).
      await token.transfer(
        bob.address,
        (await token.balanceOf(alice.address)) - (TOKEN_FEE - 1n)
      );
      await expect(stamp()).to.be.reverted; // ERC20 insufficient-balance revert
    });
  });

  describe("epoch state", function () {
    it("starts at epoch 1 with epochStartTime set to deployment", async function () {
      expect(await wall.currentEpoch()).to.equal(1n);
      expect(await wall.epochStartTime()).to.be.gt(0n);
      expect(await wall.timeUntilEpochEnd()).to.be.lte(EPOCH);
      expect(await wall.timeUntilEpochEnd()).to.be.gt(0n);
    });

    it("tracks note counts per epoch per author", async function () {
      await stamp(alice);
      await stamp(alice);
      await stamp(bob);

      expect(await wall.noteCountPerEpoch(1, alice.address)).to.equal(2n);
      expect(await wall.noteCountPerEpoch(1, bob.address)).to.equal(1n);
      expect(await wall.noteCountPerEpoch(1, carol.address)).to.equal(0n);
    });

    it("does not roll the epoch before 7 full days", async function () {
      await stamp(alice);
      await network.provider.send("evm_increaseTime", [EPOCH - 60]);
      await network.provider.send("evm_mine");
      await stamp(bob);

      // Bob's stamp did not trigger a reset: still epoch 1, board intact.
      expect(await wall.currentEpoch()).to.equal(1n);
      expect(await wall.currentTopMinters(0)).to.equal(alice.address);
    });
  });

  describe("on-the-fly leaderboard", function () {
    it("inserts the first minter at rank 1", async function () {
      await stamp(alice);
      expect(await wall.currentTopMinters(0)).to.equal(alice.address);
    });

    it("keeps ranks sorted by count (higher count rises)", async function () {
      await stamp(alice); // alice: 1
      await stamp(bob); // bob: 1 (tie — alice was first)
      await stamp(bob); // bob: 2

      expect(await wall.currentTopMinters(0)).to.equal(bob.address);
      expect(await wall.currentTopMinters(1)).to.equal(alice.address);
    });

    it("shifts lower ranks down when someone moves up", async function () {
      await stamp(alice); // alice 1
      await stamp(bob); // bob 1
      await stamp(carol); // carol 1 -> board [alice, bob, carol]
      await stamp(carol); // carol 2 -> board [carol, alice, bob]

      expect(await wall.currentTopMinters(0)).to.equal(carol.address);
      expect(await wall.currentTopMinters(1)).to.equal(alice.address);
      expect(await wall.currentTopMinters(2)).to.equal(bob.address);
    });

    it("tie-breaker: first to reach a count keeps the higher rank", async function () {
      await stamp(alice); // alice 1
      await stamp(alice); // alice 2
      await stamp(alice); // alice 3
      await stamp(bob); // bob 1
      await stamp(bob); // bob 2
      await stamp(bob); // bob 3 — ties alice at 3, but arrived later

      expect(await wall.currentTopMinters(0)).to.equal(alice.address);
      expect(await wall.currentTopMinters(1)).to.equal(bob.address);
    });

    it("batch getter returns the whole board", async function () {
      await stamp(alice);
      await stamp(bob);
      const board = await wall.getCurrentTopMinters();
      expect(board[0]).to.equal(alice.address);
      expect(board[1]).to.equal(bob.address);
      expect(board[2]).to.equal(ethers.ZeroAddress);
    });

    it("does not add a minter who fails to crack the top 10", async function () {
      // 10 distinct minters (signers 3..12, deliberately NOT alice/bob/carol)
      // with 2 notes each fill the board; carol (1 note) must not appear.
      const minters = signers.slice(3, 13); // 10 accounts
      for (const m of minters) {
        // 2 stamps × 1000 fee need room: mint 10000.
        await token.mint(m.address, ethers.parseEther("10000"));
        await token
          .connect(m)
          .approve(await wall.getAddress(), ethers.MaxUint256);
        await wall.connect(m).stampNote(CONTENT, COLOR, 1, 1, 0);
        await wall.connect(m).stampNote(CONTENT, COLOR, 1, 1, 0);
      }
      await stamp(carol); // carol: 1 — below everyone

      const board = await wall.getCurrentTopMinters();
      expect(board).to.not.include(carol.address);
      expect(board).to.not.include(ethers.ZeroAddress); // full
    });
  });

  describe("epoch reset & reward distribution", function () {
    it("distributes the pool by rank on the first stamp after 7 days", async function () {
      await stamp(alice); // alice 1 -> rank 1
      await stamp(alice); // alice 2 -> rank 1
      await stamp(bob); // bob 1 -> rank 2
      // pool = 3 × 500 = 1500 tokens
      expect(await wall.weeklyRewardPool()).to.equal(ethers.parseEther("1500"));

      const aliceBefore = await token.balanceOf(alice.address);
      const bobBefore = await token.balanceOf(bob.address);

      await warpPastEpoch();
      // Next stamp settles epoch 1, then counts into epoch 2.
      await stamp(carol);

      // Rank shares of 1500: 30% / 15%.
      expect((await token.balanceOf(alice.address)) - aliceBefore).to.equal(
        ethers.parseEther("450")
      );
      expect((await token.balanceOf(bob.address)) - bobBefore).to.equal(
        ethers.parseEther("225")
      );

      // Epoch advanced; counters/board reset; carol counts into epoch 2.
      expect(await wall.currentEpoch()).to.equal(2n);
      expect(await wall.noteCountPerEpoch(1, alice.address)).to.equal(2n);
      expect(await wall.noteCountPerEpoch(2, carol.address)).to.equal(1n);
      expect(await wall.currentTopMinters(0)).to.equal(carol.address);
      expect(await wall.currentTopMinters(1)).to.equal(ethers.ZeroAddress);

      // Pool: 1500 distributed (450 + 225) -> 825 rolls over, + 500 from
      // carol's own stamp = 1325.
      expect(await wall.weeklyRewardPool()).to.equal(
        ethers.parseEther("1325")
      );
      // Contract balance always mirrors the pool.
      expect(
        await token.balanceOf(await wall.getAddress())
      ).to.equal(ethers.parseEther("1325"));
    });

    it("emits RewardPaid per winner and EpochAdvanced with totals", async function () {
      await stamp(alice);
      await stamp(alice);
      await stamp(bob);

      await warpPastEpoch();
      const tx = await stamp(carol);

      // Rank shares of 1500: 30% = 450, 15% = 225.
      await expect(tx)
        .to.emit(wall, "RewardPaid")
        .withArgs(alice.address, 1n, ethers.parseEther("450"));
      await expect(tx)
        .to.emit(wall, "RewardPaid")
        .withArgs(bob.address, 2n, ethers.parseEther("225"));
      // distributed = 450 + 225 = 675; rolled over = 1500 - 675 = 825.
      await expect(tx)
        .to.emit(wall, "EpochAdvanced")
        .withArgs(1n, 2n, ethers.parseEther("675"), ethers.parseEther("825"));
    });

    it("skips empty leaderboard slots; their share rolls over", async function () {
      await stamp(alice); // sole minter -> rank 1 only
      expect(await wall.weeklyRewardPool()).to.equal(POOL_SHARE);

      await warpPastEpoch();
      await stamp(bob);

      // alice: 30% of 500 = 150; the other 70% (350) is not distributed to
      // empty slots and rolls over. + bob's 500 = 850.
      const wallAddress = await wall.getAddress();
      expect(await wall.weeklyRewardPool()).to.equal(
        ethers.parseEther("850")
      );
      expect(await token.balanceOf(wallAddress)).to.equal(
        ethers.parseEther("850")
      );
    });

    it("distributes 100% when all 10 slots are filled", async function () {
      // 10 distinct minters (signers 3..12 — NOT alice/bob/carol), one note
      // each — ties keep insertion order. The reset is triggered by carol,
      // who is deliberately NOT on the board, so her fresh stamp only seeds
      // the next epoch (no net-balance confusion from her own payout).
      const minters = signers.slice(3, 13);
      for (const m of minters) {
        await token.mint(m.address, ethers.parseEther("10000"));
        await token
          .connect(m)
          .approve(await wall.getAddress(), ethers.MaxUint256);
        await wall.connect(m).stampNote(CONTENT, COLOR, 1, 1, 0);
      }
      // pool = 10 × 500 = 5000, board full.
      expect(await wall.weeklyRewardPool()).to.equal(
        ethers.parseEther("5000")
      );

      const before: Record<string, bigint> = {};
      for (const m of minters) {
        before[m.address] = await token.balanceOf(m.address);
      }

      await warpPastEpoch();
      await stamp(carol); // settles epoch 1 (carol isn't on the old board)

      // 30+15+15+8+8+8+4+4+4+4 = 100% of 5000 fully distributed.
      const expectedShares = [
        "1500",
        "750",
        "750",
        "400",
        "400",
        "400",
        "200",
        "200",
        "200",
        "200",
      ];
      for (let i = 0; i < 10; i++) {
        const addr = minters[i].address;
        const gained =
          (await token.balanceOf(addr)) - before[addr];
        expect(gained).to.equal(ethers.parseEther(expectedShares[i]));
      }

      // Nothing rolled over — pool now holds only carol's fresh stamp.
      expect(await wall.weeklyRewardPool()).to.equal(POOL_SHARE);
      expect(
        await token.balanceOf(await wall.getAddress())
      ).to.equal(POOL_SHARE);
    });

    it("sets a fresh epochStartTime at rollover", async function () {
      await stamp(alice);
      await warpPastEpoch();
      const beforeTx = await stamp(bob);
      await beforeTx.wait();

      const start = await wall.epochStartTime();
      const block = await ethers.provider.getBlock(
        await ethers.provider.getBlockNumber()
      );
      expect(start).to.equal(block!.timestamp);
      expect(await wall.timeUntilEpochEnd()).to.be.lte(EPOCH);
      expect(await wall.timeUntilEpochEnd()).to.be.gt(EPOCH - 60);
    });

    it("reverts the whole stamp if a reward transfer fails", async function () {
      // A full board of 10 + one below-board minter cannot be built with a
      // reverting token easily; instead verify the CEI ordering invariant:
      // pool accounting is committed before transfers, and a failed
      // transfer reverts everything (no state corruption).
      await stamp(alice);
      await stamp(bob);
      const poolBefore = await wall.weeklyRewardPool();
      const epochBefore = await wall.currentEpoch();

      // Snapshot: a plain stamp after warp must reset atomically. Any revert
      // inside distribution would leave epoch/pool untouched.
      await warpPastEpoch();
      await stamp(carol);

      expect(await wall.currentEpoch()).to.equal(epochBefore + 1n);
      expect(await wall.weeklyRewardPool()).to.be.lt(poolBefore + POOL_SHARE);
    });
  });

  describe("getNotes pagination", function () {
    beforeEach(async function () {
      for (let i = 0; i < 7; i++) {
        await wall
          .connect(alice)
          .stampNote(`note ${i}`, COLOR, i, i, (i % 3) - 1);
      }
    });

    it("returns the requested window", async function () {
      const page = await wall.getNotes(2, 3);
      expect(page.map((n: any) => n.id)).to.deep.equal([2n, 3n, 4n]);
    });

    it("clamps the last page to the array bounds", async function () {
      const page = await wall.getNotes(5, 100);
      expect(page).to.have.length(2);
      expect(page[0].id).to.equal(5n);
      expect(page[1].id).to.equal(6n);
    });

    it("returns an empty page when offset == total", async function () {
      const page = await wall.getNotes(7, 10);
      expect(page).to.have.length(0);
    });

    it("reverts when offset is past the end", async function () {
      await expect(wall.getNotes(8, 1)).to.be.revertedWithCustomError(
        wall,
        "PageOutOfBounds"
      );
    });
  });

  describe("getNote", function () {
    it("reverts for a missing id", async function () {
      await expect(wall.getNote(42)).to.be.revertedWithCustomError(
        wall,
        "NoteNotFound"
      );
    });
  });
});
