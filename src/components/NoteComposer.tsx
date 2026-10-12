"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Dices, Loader2, MapPinned, Pin, X } from "lucide-react";
import {
  ETH_FEE,
  MAX_UINT256,
  PAYMENT_TOKEN_ADDRESS,
  TOKEN_FEE,
  erc20Abi,
  getNotesContractAddress,
  retroNotesAbi,
} from "@/lib/contract";
import {
  MAX_CONTENT_LENGTH,
  NOTE_COLORS,
  NOTE_MIN_HEIGHT,
  NOTE_WIDTH,
  PIN_COLORS,
  TAPE_COLORS,
  randomRotation,
} from "@/lib/board";

type Props = {
  position: { x: number; y: number };
  onClose: () => void;
  /** Return to placement mode to nudge the note somewhere else. */
  onMove: () => void;
  /** Called once the tx is confirmed on-chain. */
  onStamped: () => void;
};

const STATUS_TONE: Record<string, string> = {
  idle: "text-ink/50",
  warn: "text-amber-700",
  busy: "text-ink",
  error: "text-red-700",
  success: "text-green-800",
};

/**
 * The note composer: write up to 280 chars, pick a pastel color, reroll
 * the tilt, then "Stamp Permanently On-Chain" via stampNote() which also
 * mints the note as an ERC-721 NFT to the author.
 */
export default function NoteComposer({
  position,
  onClose,
  onMove,
  onStamped,
}: Props) {
  const [content, setContent] = useState("");
  const [color, setColor] = useState(NOTE_COLORS[0].hex);
  const [rotation, setRotation] = useState<number>(() => randomRotation());

  const contractAddress = getNotesContractAddress();
  const chainId = useChainId();
  const { address: account, isConnected } = useAccount();

  // Allowance the payment token grants this wall (0 until approved).
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: PAYMENT_TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && contractAddress ? [account, contractAddress] : undefined,
    query: { enabled: Boolean(account && contractAddress) },
  });
  const needsApproval = allowance === undefined || (allowance as bigint) < TOKEN_FEE;

  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    error: writeError,
    reset,
  } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const trimmed = content.trim();
  const overLimit = trimmed.length > MAX_CONTENT_LENGTH;
  const canStamp =
    trimmed.length > 0 &&
    !overLimit &&
    isConnected &&
    Boolean(contractAddress) &&
    !isSigning &&
    !isConfirming;

  // Close ESC-to-dismiss while idle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSigning && !isConfirming) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, isSigning, isConfirming]);

  // Confirmed on-chain → notify parent, reset flow. On an approval tx,
  // refresh the allowance so the button flips to "stamp" without a reload.
  useEffect(() => {
    if (!isConfirmed) return;
    if (needsApproval) {
      void refetchAllowance();
    } else {
      onStamped();
    }
  }, [isConfirmed, needsApproval, refetchAllowance, onStamped]);

  function handleStamp() {
    if (!contractAddress || !canStamp) return;
    reset();

    // Step 1: grant the wall an unlimited allowance for the payment token.
    if (needsApproval) {
      writeContract({
        address: PAYMENT_TOKEN_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [contractAddress, MAX_UINT256],
        chainId,
      });
      return;
    }

    // Step 2: stamp, attaching the ETH fee (forwarded to the recipient).
    writeContract({
      address: contractAddress,
      abi: retroNotesAbi,
      functionName: "stampNote",
      args: [trimmed, color, position.x, position.y, rotation],
      value: ETH_FEE,
      chainId,
    });
  }

  // Status line
  let status = "";
  let tone = STATUS_TONE.idle;
  if (overLimit) {
    status = `TOO LONG — ${trimmed.length}/${MAX_CONTENT_LENGTH} CHARS`;
    tone = STATUS_TONE.error;
  } else if (!contractAddress) {
    status = "CONTRACT NOT SET — ADD NEXT_PUBLIC_NOTES_CONTRACT_ADDRESS";
    tone = STATUS_TONE.warn;
  } else if (!isConnected) {
    status = "CONNECT A WALLET TO STAMP ON-CHAIN";
    tone = STATUS_TONE.warn;
  } else if (isSigning) {
    status = "SIGN THE TX IN YOUR WALLET…";
    tone = STATUS_TONE.busy;
  } else if (isConfirming) {
    status = `${needsApproval ? "APPROVING" : "STAMPING"} ON-CHAIN… ${txHash ? `${txHash.slice(0, 10)}…` : ""}`;
    tone = STATUS_TONE.busy;
  } else if (writeError || receiptError) {
    const msg = (writeError ?? receiptError)?.message ?? "TX FAILED";
    status = msg.split("\n")[0].slice(0, 90).toUpperCase();
    tone = STATUS_TONE.error;
  } else if (needsApproval) {
    status = "STEP 1/2 — APPROVE 0.02 FRNPET, THEN STAMP";
    tone = STATUS_TONE.busy;
  } else {
    status = `READY — 0.02 FRNPET (BURNED) + 0.00005 ETH`;
    tone = STATUS_TONE.idle;
  }

  const busy = isSigning || isConfirming;

  return (
    <motion.div
      className="fixed inset-0 z-[300000] flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <motion.div
        className="retro-panel w-full max-w-3xl"
        initial={{ y: 28, rotate: -1, opacity: 0 }}
        animate={{ y: 0, rotate: 0, opacity: 1 }}
        exit={{ y: 28, opacity: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        role="dialog"
        aria-modal="true"
        aria-label="Compose a new note"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between border-b-2 border-ink bg-[#FFD84D] px-4 py-2">
          <h2 className="font-retro text-2xl uppercase leading-none tracking-wide">
            ✎ Stamp a new note
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="border-2 border-ink bg-cream p-1 shadow-[2px_2px_0_#2B2A26] transition-transform hover:-translate-y-[1px] disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={3} />
          </button>
        </div>

        <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_220px]">
          {/* Left: editor */}
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <div className="mb-1 flex items-baseline justify-between font-retro text-lg leading-none text-ink/60">
                <label htmlFor="note-content">YOUR MESSAGE</label>
                <span
                  className={
                    trimmed.length > 240
                      ? "text-amber-700"
                      : "text-ink/50"
                  }
                >
                  {trimmed.length}/{MAX_CONTENT_LENGTH}
                </span>
              </div>
              <textarea
                id="note-content"
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, 320))}
                placeholder="gm from the blockchain…"
                rows={4}
                className="retro-input resize-none"
              />
            </div>

            {/* Color selector */}
            <div>
              <p className="mb-2 font-retro text-lg leading-none text-ink/60">
                PAPER COLOR
              </p>
              <div className="flex flex-wrap gap-2">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.name}
                    onClick={() => setColor(c.hex)}
                    className={`h-9 w-9 rounded-full border-2 transition-transform ${
                      color === c.hex
                        ? "scale-110 border-ink shadow-[2px_2px_0_#2B2A26]"
                        : "border-ink/30 hover:scale-105"
                    }`}
                    style={{ background: c.hex }}
                  >
                    <span className="sr-only">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Rotation */}
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-retro text-lg leading-none text-ink/60">
                TILT: <span className="text-ink">{rotation}°</span>
              </p>
              <button
                type="button"
                onClick={() => setRotation(randomRotation())}
                className="retro-btn px-3 py-1 text-base"
              >
                <Dices className="h-4 w-4" /> Reroll
              </button>
              <button
                type="button"
                onClick={onMove}
                disabled={busy}
                className="retro-btn px-3 py-1 text-base"
              >
                <MapPinned className="h-4 w-4" /> Move on board
              </button>
            </div>

            {/* Status + stamp */}
            <div className="mt-auto flex flex-col gap-2">
              <p className={`font-retro text-lg leading-none ${tone}`}>
                {busy && (
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                )}
                {status}
              </p>
              <button
                type="button"
                onClick={handleStamp}
                disabled={!canStamp}
                className="retro-btn retro-btn-primary w-full justify-center py-3 text-2xl"
              >
                <Pin className="h-5 w-5" strokeWidth={3} />
                Stamp Permanently On-Chain
              </button>
              <p className="text-center font-retro text-base leading-none text-ink/40">
                Position X:{position.x} Y:{position.y} · immutable · gas required
              </p>
            </div>
          </div>

          {/* Right: live preview */}
          <div className="flex items-start justify-center">
            <div className="relative" style={{ width: NOTE_WIDTH }}>
              <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
                <div
                  className="h-[18px] w-[18px] rounded-full shadow-pin"
                  style={{
                    background: `radial-gradient(circle at 32% 28%, #ffffff 0%, ${
                      PIN_COLORS[1]
                    } 45%, rgba(0,0,0,0.35) 100%)`,
                  }}
                />
                <div className="mx-auto -mt-[2px] h-2 w-[3px] rounded-b bg-black/30" />
              </div>
              <div
                className="rounded-[3px] px-4 pb-9 pt-7 shadow-note"
                style={{
                  background: color,
                  minHeight: NOTE_MIN_HEIGHT,
                  transform: `rotate(${rotation}deg)`,
                  backgroundImage:
                    "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 28%, rgba(0,0,0,0.05) 100%)",
                  transition: "transform 200ms ease, background 200ms ease",
                }}
              >
                <p className="whitespace-pre-wrap break-words font-hand text-[26px] leading-[1.15] text-ink">
                  {trimmed || "your note appears here…"}
                </p>
                <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-end justify-between font-retro text-[15px] leading-none text-ink/45">
                  <span>you</span>
                  <span>now</span>
                </div>
              </div>
              <div
                className="pointer-events-none absolute -top-3 left-1/2 h-7 w-24 -translate-x-1/2 -rotate-3 rounded-[2px]"
                style={{
                  background: `linear-gradient(180deg, rgba(255,255,255,0.5) 0%, ${
                    TAPE_COLORS[0]
                  } 100%)`,
                  display: "none",
                }}
              />
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
