import { expect } from "chai";
import { ethers, network } from "hardhat";

const CONTENT = "gm from the corkboard!";
const COLOR = "#FFF2A5";

// Must match contracts/IMDRetroWall.sol constants.
const PAYMENT_TOKEN = "0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105";
const TOKEN_BURN = "0x000000000000000000000000000000000000dEaD";
const ETH_RECIPIENT = "0x8d5Ba1fc60fe4d6FB41ED2176f3f2E05FEBC0cA5";
const TOKEN_FEE = ethers.parseEther("0.02"); // 2e16, 18 decimals
const ETH_FEE = ethers.parseEther("0.00005"); // 5e13 wei

describe("IMDRetroWall", function () {
  // `any` keeps these runnable without typechain. Behaviour is fully asserted.
  let wall: any;
  let token: any;
  let alice: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let bob: typeof alice;

  /**
   * Attach a minimal ERC-20 implementation at the hardcoded PAYMENT_TOKEN
   * address so tests exercise the real on-chain wiring (transferFrom burns
   * straight to TOKEN_BURN) without depending on the live Base mainnet token.
   */
  async function installMockToken() {
    const Mock = await ethers.getContractFactory("MockPaymentToken");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    const impl = await ethers.provider.getCode(await mock.getAddress());
    await network.provider.send("hardhat_setCode", [PAYMENT_TOKEN, impl]);
    // Re-bind at the canonical address; storage (balances) lives there too.
    return Mock.attach(PAYMENT_TOKEN);
  }

  beforeEach(async function () {
    [alice, bob] = await ethers.getSigners();

    token = await installMockToken();

    const factory = await ethers.getContractFactory("IMDRetroWall");
    wall = await factory.deploy();
    await wall.waitForDeployment();

    // Fund alice and bob with FRNPET, then grant the wall an unlimited
    // allowance (matches the frontend's approve-once behaviour) so each user
    // can stamp many notes without re-approving.
    const wallAddress = await wall.getAddress();
    for (const user of [alice, bob]) {
      await token.mint(user.address, ethers.parseEther("1000"));
      await token.connect(user).approve(wallAddress, ethers.MaxUint256);
    }
  });

  describe("stampNote", function () {
    it("stores the note, assigns a sequential id, and mints the NFT", async function () {
      await wall
        .connect(alice)
        .stampNote(CONTENT, COLOR, 1200, 3400, 7, { value: ETH_FEE });
      await wall
        .connect(bob)
        .stampNote("second note", "#AEE2FF", 100, 200, -12, { value: ETH_FEE });

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
      await wall
        .connect(alice)
        .stampNote(CONTENT, COLOR, 10, 20, 0, { value: ETH_FEE });
      await wall
        .connect(bob)
        .stampNote(CONTENT, COLOR, 11, 21, 1, { value: ETH_FEE });

      expect(await wall.ownerOf(0)).to.equal(alice.address);
      expect(await wall.ownerOf(1)).to.equal(bob.address);
      expect(await wall.balanceOf(alice.address)).to.equal(1n);
      expect(await wall.balanceOf(bob.address)).to.equal(1n);
      expect(await wall.name()).to.equal("IMD Retro Wall Note");
      expect(await wall.symbol()).to.equal("IMDNOTE");
    });

    it("returns an on-chain data-URI tokenURI with the note attributes", async function () {
      await wall
        .connect(alice)
        .stampNote(CONTENT, "#FFC5D0", 7, 9, -3, { value: ETH_FEE });
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

    it("emits NoteCreated with the full payload", async function () {
      const tx = await wall
        .connect(alice)
        .stampNote(CONTENT, "#FFC5D0", 5, 6, -3, { value: ETH_FEE });

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
      await wall
        .connect(alice)
        .stampNote(content280, COLOR, 1, 1, 0, { value: ETH_FEE });
      expect((await wall.getNote(0)).content).to.have.length(280);
    });

    it("reverts on empty content", async function () {
      await expect(
        wall.connect(alice).stampNote("", COLOR, 1, 1, 0, { value: ETH_FEE })
      ).to.be.revertedWithCustomError(wall, "EmptyContent");
    });

    it("reverts on 281 bytes of content", async function () {
      await expect(
        wall
          .connect(alice)
          .stampNote("a".repeat(281), COLOR, 1, 1, 0, { value: ETH_FEE })
      ).to.be.revertedWithCustomError(wall, "ContentTooLong");
    });

    it("reverts on malformed colors", async function () {
      for (const bad of ["#FFF2A", "FFF2A5", "#GGG", "#1234567", ""]) {
        await expect(
          wall.connect(alice).stampNote(CONTENT, bad, 1, 1, 0, { value: ETH_FEE })
        ).to.be.revertedWithCustomError(wall, "InvalidColor");
      }
    });

    it("accepts 0x-prefixed and uppercase hex colors", async function () {
      await wall
        .connect(alice)
        .stampNote(CONTENT, "0xFFF2A5", 1, 1, 0, { value: ETH_FEE });
      await wall
        .connect(alice)
        .stampNote(CONTENT, "#abcdef", 1, 1, 0, { value: ETH_FEE });
      expect(await wall.getTotalNotes()).to.equal(2n);
    });

    it("reverts on out-of-range rotation", async function () {
      await expect(
        wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, 16, { value: ETH_FEE })
      ).to.be.revertedWithCustomError(wall, "InvalidRotation");
      await expect(
        wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, -16, { value: ETH_FEE })
      ).to.be.revertedWithCustomError(wall, "InvalidRotation");
    });
  });

  describe("payment (0.02 FRNPET burned + 0.00005 ETH forwarded)", function () {
    it("burns exactly the token fee to the dead address", async function () {
      const before = await token.balanceOf(TOKEN_BURN);
      await wall
        .connect(alice)
        .stampNote(CONTENT, COLOR, 1, 1, 0, { value: ETH_FEE });
      const after = await token.balanceOf(TOKEN_BURN);
      expect(after - before).to.equal(TOKEN_FEE);
    });

    it("never holds a token balance itself (burn is direct)", async function () {
      await wall
        .connect(alice)
        .stampNote(CONTENT, COLOR, 1, 1, 0, { value: ETH_FEE });
      expect(await token.balanceOf(await wall.getAddress())).to.equal(0n);
    });

    it("forwards the ETH fee to ETH_RECIPIENT", async function () {
      const before = await ethers.provider.getBalance(ETH_RECIPIENT);
      await wall
        .connect(alice)
        .stampNote(CONTENT, COLOR, 1, 1, 0, { value: ETH_FEE });
      const after = await ethers.provider.getBalance(ETH_RECIPIENT);
      expect(after - before).to.equal(ETH_FEE);
    });

    it("reverts when the ETH fee is wrong", async function () {
      await expect(
        wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, 0) // no value
      ).to.be.revertedWithCustomError(wall, "IncorrectEthFee");
      await expect(
        wall
          .connect(alice)
          .stampNote(CONTENT, COLOR, 1, 1, 0, { value: ETH_FEE - 1n })
      ).to.be.revertedWithCustomError(wall, "IncorrectEthFee");
    });

    it("reverts when the token allowance is missing", async function () {
      await token.connect(alice).approve(await wall.getAddress(), 0n);
      await expect(
        wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, 0, { value: ETH_FEE })
      ).to.be.reverted; // ERC20 insufficient-allowance revert
    });

    it("reverts when the token balance is too low", async function () {
      // Drain alice down to less than the fee (allowance is already unlimited).
      await token.transfer(
        bob.address,
        (await token.balanceOf(alice.address)) - (TOKEN_FEE - 1n)
      );
      await expect(
        wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, 0, { value: ETH_FEE })
      ).to.be.reverted; // ERC20 insufficient-balance revert
    });
  });

  describe("getNotes pagination", function () {
    beforeEach(async function () {
      for (let i = 0; i < 7; i++) {
        await wall
          .connect(alice)
          .stampNote(`note ${i}`, COLOR, i, i, (i % 3) - 1, { value: ETH_FEE });
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
