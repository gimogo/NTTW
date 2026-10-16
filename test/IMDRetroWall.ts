import { expect } from "chai";
// solc ships without type declarations; require keeps it typed as the module.
const solc = require("solc");
import { ethers, network } from "hardhat";

/**
 * Minimal ERC-20 compiled AT TEST TIME with solc (in-memory, never written
 * into `contracts/`). Decimals are configurable so the decimals guard can be tested.
 */
const MOCK_TOKEN_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPaymentToken {
    string public name = "Mock Notes";
    string public symbol = "mNOTES";
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint8 d) {
        decimals = d;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "mNOTES: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "mNOTES: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
`;

function compileMockToken(): { abi: any; bytecode: string } {
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "MockPaymentToken.sol": { content: MOCK_TOKEN_SOURCE } },
        settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } },
      })
    )
  );
  const errors = (output.errors ?? []).filter((e: any) => e.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((e: any) => e.formattedMessage).join("\n"));
  }
  const c = output.contracts["MockPaymentToken.sol"].MockPaymentToken;
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

const COMPILED_TOKEN = compileMockToken();

const CONTENT = "gm from the corkboard!";
const COLOR = "#FFF2A5";

// Must match contracts/IMDRetroWall.sol constants.
const TOKEN_BURN = "0x000000000000000000000000000000000000dEaD";
const BURN_SHARE = ethers.parseEther("500");
const POOL_SHARE = ethers.parseEther("500");
const STAMP_COST = ethers.parseEther("1000");
const EPOCH = 3 * 24 * 60 * 60;
const RETRY_DELAY = 24 * 60 * 60;

// CCIP chain selectors (Robinhood Chain = wall, Base = relay).
const ROBINHOOD_SELECTOR = 6180753054346818345n;
const BASE_SELECTOR = 15971525489660198786n;

// Placeholder key hash for the mock; the real Base key hash is set at deploy time.
const KEY_HASH = ethers.id("mock-key-hash");
const WORD = 123456789012345678901234567890n;

const coder = ethers.AbiCoder.defaultAbiCoder();

type Signer = Awaited<ReturnType<typeof ethers.getSigners>>[number];

async function impersonate(addr: string): Promise<Signer> {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] });
  await network.provider.request({
    method: "hardhat_setBalance",
    params: [addr, "0x56BC75E2D63100000"],
  });
  return ethers.getSigner(addr);
}

function ccipMessage(sourceSelector: bigint, sender: string, data: string) {
  return {
    messageId: ethers.ZeroHash,
    sourceChainSelector: sourceSelector,
    sender: coder.encode(["address"], [sender]),
    data,
    destTokenAmounts: [],
  };
}

describe("IMDRetroWall v3 + VrfCcipRelay", function () {
  let signers: Signer[];
  let alice: Signer;
  let bob: Signer;
  let carol: Signer;
  let token: any;
  let router: any;
  let vrf: any;
  let wall: any;
  let relay: any;
  let wallAddress: string;
  let relayAddress: string;
  let routerAddress: string;

  async function deployMockToken(decimals = 18) {
    const factory = new ethers.ContractFactory(COMPILED_TOKEN.abi, COMPILED_TOKEN.bytecode, signers[0]);
    const t = await factory.deploy(decimals);
    await t.waitForDeployment();
    return t;
  }

  async function fundAndApprove(who: Signer, stamps: number) {
    await token.mint(await who.getAddress(), STAMP_COST * BigInt(stamps));
    await token.connect(who).approve(wallAddress, ethers.MaxUint256);
  }

  async function stamp(who: Signer, content = CONTENT) {
    return wall.connect(who).stampNote(content, COLOR, 10, 20, 0);
  }

  /** Move the chain so the current epoch is `k` (k must be ahead of now). */
  async function goToEpoch(k: number) {
    const genesis = Number(await wall.GENESIS());
    await network.provider.send("evm_setNextBlockTimestamp", [genesis + (k - 1) * EPOCH + 1]);
    await network.provider.send("evm_mine");
  }

  /** Request settlement for `epoch`, then fulfill VRF with `word` (no delivery). */
  async function requestAndFulfill(epoch: number, word: bigint) {
    const fee = await router.fee();
    await wall.connect(carol).requestSettlement(epoch, { value: fee });
    const requestId = (await vrf.nextRequestId()) - 1n;
    await vrf.fulfill(requestId, word);
    return requestId;
  }

  beforeEach(async function () {
    signers = await ethers.getSigners();
    [alice, bob, carol] = [signers[1], signers[2], signers[3]];

    token = await deployMockToken(18);

    router = await (await ethers.getContractFactory("MockCCIPRouter")).deploy();
    vrf = await (await ethers.getContractFactory("MockVRFCoordinator")).deploy();
    routerAddress = await router.getAddress();

    wall = await (await ethers.getContractFactory("IMDRetroWall")).deploy(
      await token.getAddress(),
      routerAddress,
      BASE_SELECTOR
    );
    wallAddress = await wall.getAddress();

    relay = await (await ethers.getContractFactory("VrfCcipRelay")).deploy(
      await vrf.getAddress(),
      1,
      KEY_HASH,
      routerAddress,
      ROBINHOOD_SELECTOR,
      wallAddress
    );
    relayAddress = await relay.getAddress();

    await router.setSelector(wallAddress, ROBINHOOD_SELECTOR);
    await router.setSelector(relayAddress, BASE_SELECTOR);
    await wall.connect(signers[0]).setRelay(relayAddress);

    // The relay pays CCIP fees from its ETH balance.
    await carol.sendTransaction({ to: relayAddress, value: ethers.parseEther("1") });
  });

  describe("deployment", function () {
    it("wires the router, lane selector and relay", async function () {
      expect(await wall.CCIP_ROUTER()).to.equal(routerAddress);
      expect(await wall.RELAY_CHAIN_SELECTOR()).to.equal(BASE_SELECTOR);
      expect(await wall.relay()).to.equal(relayAddress);
      expect(await wall.GENESIS()).to.be.gt(0n);
    });

    // keccak("ccipReceive((bytes32,uint64,bytes,bytes,(address,uint256)[])\"\")
    // Interface id of IAny2EVMMessageReceiver, verified 0x85572ffb on-chain via a
    // live CCIP execution trace (the offRamp probes exactly this id).
    const CCIP_RECEIVER_ID = "0x85572ffb";

    it("advises the CCIP receiver interface over ERC-165 (wall)", async function () {
      expect(await wall.supportsInterface(CCIP_RECEIVER_ID)).to.equal(true);
      expect(await wall.supportsInterface("0x01ffc9a7")).to.equal(true); // IERC165
      expect(await wall.supportsInterface("0xffffffff")).to.equal(false); // required false
    });

    it("advises the CCIP receiver interface over ERC-165 (relay)", async function () {
      expect(await relay.supportsInterface(CCIP_RECEIVER_ID)).to.equal(true);
      expect(await relay.supportsInterface("0x01ffc9a7")).to.equal(true); // IERC165
      expect(await relay.supportsInterface("0xffffffff")).to.equal(false); // required false
      expect(await relay.supportsInterface("0x12345678")).to.equal(false); // unknown: false, not revert
    });

    it("rejects a second setRelay and a setRelay from a non-deployer", async function () {
      await expect(wall.connect(signers[0]).setRelay(alice.address)).to.be.revertedWithCustomError(
        wall,
        "RelayAlreadySet"
      );
      const fresh = await (await ethers.getContractFactory("IMDRetroWall")).deploy(
        await token.getAddress(),
        routerAddress,
        BASE_SELECTOR
      );
      const setRelayFn = fresh.connect(alice).getFunction("setRelay");
      await expect(setRelayFn(alice.address)).to.be.revertedWithCustomError(
        fresh,
        "NotDeployer"
      );
    });

    it("rejects a payment token that is not 18 decimals", async function () {
      const sixDecimals = await deployMockToken(6);
      await expect(
        (await ethers.getContractFactory("IMDRetroWall")).deploy(
          await sixDecimals.getAddress(),
          routerAddress,
          BASE_SELECTOR
        )
      )
        .to.be.revertedWithCustomError(wall, "InvalidTokenDecimals")
        .withArgs(6);
    });
  });

  describe("stamping and tickets", function () {
    it("burns 500 tokens, keeps 500 in the pool, mints the note and adds one ticket", async function () {
      await fundAndApprove(alice, 1);
      await expect(stamp(alice)).to.emit(wall, "NoteCreated");

      expect(await token.balanceOf(TOKEN_BURN)).to.equal(BURN_SHARE);
      expect(await token.balanceOf(wallAddress)).to.equal(POOL_SHARE);
      expect(await wall.epochPrize(1)).to.equal(POOL_SHARE);
      expect(await wall.ticketCount(1)).to.equal(1n);
      expect(await wall.ticketOf(1, 0)).to.equal(alice.address);
      expect(await wall.ownerOf(0)).to.equal(alice.address);
    });

    it("gives one ticket per stamp", async function () {
      await fundAndApprove(alice, 3);
      await stamp(alice);
      await stamp(alice);
      await stamp(alice);
      expect(await wall.ticketCount(1)).to.equal(3n);
      expect(await wall.epochPrize(1)).to.equal(POOL_SHARE * 3n);
    });

    it("caps stamps at 5 per address per epoch and resets in the next epoch", async function () {
      await fundAndApprove(alice, 6);
      for (let i = 0; i < 5; i++) await stamp(alice);
      await expect(stamp(alice))
        .to.be.revertedWithCustomError(wall, "StampLimitReached")
        .withArgs(5);

      await goToEpoch(2);
      await stamp(alice);
      expect(await wall.ticketCount(2)).to.equal(1n);
      expect(await wall.stampsInEpoch(2, alice.address)).to.equal(1n);
    });

    it("validates content, color and rotation", async function () {
      await fundAndApprove(alice, 1);
      await expect(stamp(alice, "")).to.be.revertedWithCustomError(wall, "EmptyContent");
      await expect(stamp(alice, "a".repeat(281)))
        .to.be.revertedWithCustomError(wall, "ContentTooLong")
        .withArgs(281);
      await expect(wall.connect(alice).stampNote(CONTENT, "red", 1, 1, 0)).to.be.revertedWithCustomError(
        wall,
        "InvalidColor"
      );
      await expect(wall.connect(alice).stampNote(CONTENT, COLOR, 1, 1, 16))
        .to.be.revertedWithCustomError(wall, "InvalidRotation")
        .withArgs(16);
    });

    it("accepts exactly 280 bytes of multi-byte UTF-8", async function () {
      await fundAndApprove(alice, 1);
      await stamp(alice, "é".repeat(140));
      expect(await wall.getTotalNotes()).to.equal(1n);
    });

    it("serves valid metadata and paged reads", async function () {
      await fundAndApprove(alice, 2);
      await stamp(alice, 'say "hi"');
      await stamp(alice, CONTENT);

      const uri: string = await wall.tokenURI(0);
      const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
      expect(json.name).to.equal("IMD Note #0");
      expect(json.attributes.find((a: any) => a.trait_type === "Content").value).to.equal('say "hi"');

      const page = await wall.getNotes(0, 10);
      expect(page.length).to.equal(2);
      expect(page[1].content).to.equal(CONTENT);
      expect((await wall.getNotes(2, 10)).length).to.equal(0);
      await expect(wall.getNote(9)).to.be.revertedWithCustomError(wall, "NoteNotFound").withArgs(9);
    });
  });

  describe("settlement", function () {
    it("cannot settle the current or epoch 0", async function () {
      await expect(wall.connect(carol).requestSettlement(1))
        .to.be.revertedWithCustomError(wall, "EpochNotEnded")
        .withArgs(1);
      await expect(wall.connect(carol).requestSettlement(0))
        .to.be.revertedWithCustomError(wall, "EpochNotEnded")
        .withArgs(0);
    });

    it("settles an epoch with no tickets without a relay call", async function () {
      await goToEpoch(2);
      await expect(wall.connect(carol).requestSettlement(1))
        .to.emit(wall, "WinnerDrawn")
        .withArgs(1n, ethers.ZeroAddress, 0n, 0n);
      expect(await wall.settlementStatus(1)).to.equal(2n);
    });

    it("draws one winner from the tickets and credits the whole pool to that winner", async function () {
      await fundAndApprove(alice, 2);
      await fundAndApprove(bob, 1);
      await stamp(alice);
      await stamp(alice);
      await stamp(bob);
      await goToEpoch(2);

      const fee = await router.fee();
      await expect(wall.connect(carol).requestSettlement(1, { value: fee })).to.emit(
        wall,
        "SettlementRequested"
      );
      const requestId = (await vrf.nextRequestId()) - 1n;
      await vrf.fulfill(requestId, WORD);

      const winner: string = await wall.ticketOf(1, WORD % 3n);
      const prize = POOL_SHARE * 3n;
      await expect(relay.deliver(1))
        .to.emit(wall, "WinnerDrawn")
        .withArgs(1n, winner, prize, WORD);

      expect(await wall.claimable(winner)).to.equal(prize);
      expect(await wall.totalClaimable()).to.equal(prize);
      expect(await wall.epochPrize(1)).to.equal(0n);

      const winnerSigner = await ethers.getSigner(winner);
      await expect(wall.connect(winnerSigner).claimReward())
        .to.emit(wall, "RewardClaimed")
        .withArgs(winner, prize);
      expect(await token.balanceOf(winner)).to.equal(prize);
      expect(await wall.claimable(winner)).to.equal(0n);
    });

    it("does not pay twice: a second delivery is a no-op and a settled epoch cannot be requested", async function () {
      await fundAndApprove(alice, 1);
      await stamp(alice);
      await goToEpoch(2);
      await requestAndFulfill(1, WORD);
      await relay.deliver(1);
      expect(await wall.claimable(alice.address)).to.equal(POOL_SHARE);

      expect(await relay.deliver.staticCall(1)).to.equal(ethers.ZeroHash);
      await relay.deliver(1);
      expect(await wall.claimable(alice.address)).to.equal(POOL_SHARE);

      await expect(wall.connect(carol).requestSettlement(1, { value: await router.fee() }))
        .to.be.revertedWithCustomError(wall, "EpochAlreadySettled")
        .withArgs(1);
    });

    it("blocks a duplicate request while pending, and allows a retry after the delay", async function () {
      await fundAndApprove(alice, 1);
      await stamp(alice);
      await goToEpoch(2);

      const fee = await router.fee();
      await wall.connect(carol).requestSettlement(1, { value: fee });
      await expect(wall.connect(carol).requestSettlement(1, { value: fee }))
        .to.be.revertedWithCustomError(wall, "SettlementPending");

      await network.provider.send("evm_increaseTime", [RETRY_DELAY]);
      await network.provider.send("evm_mine");
      await expect(wall.connect(carol).requestSettlement(1, { value: fee })).to.emit(
        wall,
        "SettlementRequested"
      );
    });

    it("delivers a word that already arrived when the wall retries (no new VRF request)", async function () {
      await fundAndApprove(alice, 1);
      await stamp(alice);
      await goToEpoch(2);

      // First request: VRF fulfills but delivery is never triggered.
      await requestAndFulfill(1, WORD);
      expect(await relay.randomnessReady(1)).to.equal(true);

      await network.provider.send("evm_increaseTime", [RETRY_DELAY]);
      await network.provider.send("evm_mine");
      const before = await vrf.nextRequestId();
      await expect(wall.connect(carol).requestSettlement(1, { value: await router.fee() })).to.emit(
        wall,
        "WinnerDrawn"
      );
      expect(await vrf.nextRequestId()).to.equal(before);
      expect(await wall.claimable(alice.address)).to.equal(POOL_SHARE);
    });

    it("rejects an insufficient CCIP fee and refunds overpayment", async function () {
      await fundAndApprove(alice, 1);
      await stamp(alice);
      await goToEpoch(2);
      const fee = await router.fee();

      await expect(wall.connect(carol).requestSettlement(1, { value: fee - 1n }))
        .to.be.revertedWithCustomError(wall, "InsufficientFee")
        .withArgs(fee, fee - 1n);

      await expect(
        wall.connect(carol).requestSettlement(1, { value: fee * 2n })
      ).to.changeEtherBalance(carol, -fee);
    });
  });

  describe("CCIP message validation", function () {
    it("wall accepts ccipReceive only from the router, the relay, and the relay lane", async function () {
      await goToEpoch(2);
      const data = coder.encode(["uint256", "uint256"], [1, WORD]);

      await expect(wall.connect(alice).ccipReceive(ccipMessage(BASE_SELECTOR, relayAddress, data)))
        .to.be.revertedWithCustomError(wall, "NotRouter")
        .withArgs(alice.address);

      const routerSigner = await impersonate(routerAddress);
      await expect(
        wall.connect(routerSigner).ccipReceive(ccipMessage(ROBINHOOD_SELECTOR, relayAddress, data))
      )
        .to.be.revertedWithCustomError(wall, "UnexpectedSourceChain")
        .withArgs(ROBINHOOD_SELECTOR);
      await expect(
        wall.connect(routerSigner).ccipReceive(ccipMessage(BASE_SELECTOR, alice.address, data))
      )
        .to.be.revertedWithCustomError(wall, "UnexpectedSender")
        .withArgs(alice.address);
    });

    it("relay accepts ccipReceive only from the router, the wall, and the wall lane", async function () {
      const data = coder.encode(["uint256"], [1]);

      await expect(relay.connect(alice).ccipReceive(ccipMessage(ROBINHOOD_SELECTOR, wallAddress, data)))
        .to.be.revertedWithCustomError(relay, "NotRouter")
        .withArgs(alice.address);

      const routerSigner = await impersonate(routerAddress);
      await expect(
        relay.connect(routerSigner).ccipReceive(ccipMessage(BASE_SELECTOR, wallAddress, data))
      )
        .to.be.revertedWithCustomError(relay, "UnexpectedSourceChain")
        .withArgs(BASE_SELECTOR);
      await expect(
        relay.connect(routerSigner).ccipReceive(ccipMessage(ROBINHOOD_SELECTOR, alice.address, data))
      )
        .to.be.revertedWithCustomError(relay, "UnexpectedSender")
        .withArgs(alice.address);
    });

    it("relay accepts VRF fulfillment only from the coordinator", async function () {
      await expect(relay.connect(alice).rawFulfillRandomWords(1, [WORD]))
        .to.be.revertedWithCustomError(relay, "NotCoordinator")
        .withArgs(alice.address);
    });

    it("relay cannot deliver before randomness arrives, or when it cannot pay the fee", async function () {
      await expect(relay.deliver(1)).to.be.revertedWithCustomError(relay, "NotReady").withArgs(1);

      await fundAndApprove(alice, 1);
      await stamp(alice);
      await goToEpoch(2);
      await requestAndFulfill(1, WORD);

      await router.setFee(ethers.parseEther("10"));
      await expect(relay.deliver(1)).to.be.revertedWithCustomError(relay, "InsufficientBalance");
    });
  });
});

