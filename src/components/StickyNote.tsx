"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  NOTE_MIN_HEIGHT,
  NOTE_WIDTH,
  PIN_COLORS,
  TAPE_COLORS,
  timeAgo,
  truncateAddress,
} from "@/lib/board";
import type { BoardNote } from "@/lib/contract";

const PAPER_TEXTURE: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 28%, rgba(0,0,0,0.05) 100%)",
};

/** Colorful push-pin, deterministic per note id. */
function PushPin({ color }: { color: string }) {
  return (
    <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2">
      <div
        className="h-[18px] w-[18px] rounded-full shadow-pin"
        style={{
          background: `radial-gradient(circle at 32% 28%, #ffffff 0%, ${color} 45%, rgba(0,0,0,0.35) 100%)`,
        }}
      />
      <div className="mx-auto -mt-[2px] h-2 w-[3px] rounded-b bg-black/30" />
    </div>
  );
}

/** Translucent washi-tape strip, deterministic per note id. */
function WashiTape({ color }: { color: string }) {
  return (
    <div
      className="absolute -top-3 left-1/2 z-10 h-7 w-24 -translate-x-1/2 -rotate-3 rounded-[2px]"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.5) 0%, ${color} 100%)`,
        boxShadow:
          "0 1px 3px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.3)",
      }}
    />
  );
}

type Props = {
  note: BoardNote;
  /** Base stacking order — newer notes get higher values. */
  z: number;
  onClick?: (id: number) => void;
};

/**
 * A single sticky note: random tilt, tactile shadow, pin/tape, and a
 * hover "peel" (lift + opacity 0.85) that hints at notes underneath.
 */
export default function StickyNote({ note, z, onClick }: Props) {
  const [hovered, setHovered] = useState(false);
  const usePin = note.id % 2 === 0;
  const pinColor = PIN_COLORS[note.id % PIN_COLORS.length];
  const tapeColor = TAPE_COLORS[note.id % TAPE_COLORS.length];

  return (
    <motion.div
      className="absolute left-0 top-0 cursor-grab active:cursor-grabbing"
      style={{
        left: note.posX,
        top: note.posY,
        width: NOTE_WIDTH,
        zIndex: hovered ? 100_000 : z,
      }}
      initial={{ opacity: 0, scale: 0.6, rotate: note.rotation * 2.2 }}
      animate={{ opacity: 1, scale: 1, rotate: note.rotation }}
      whileHover={{
        scale: 1.05,
        y: -10,
        opacity: 0.85,
        rotate: note.rotation * 0.3,
        transition: { type: "spring", stiffness: 320, damping: 22 },
      }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={() => onClick?.(note.id)}
      transition={{ type: "spring", stiffness: 240, damping: 20 }}
    >
      {usePin ? <PushPin color={pinColor} /> : <WashiTape color={tapeColor} />}

      <div
        className="relative rounded-[3px] px-4 pb-9 pt-7 shadow-note"
        style={{
          background: note.color,
          minHeight: NOTE_MIN_HEIGHT,
          ...PAPER_TEXTURE,
        }}
      >
        <p className="whitespace-pre-wrap break-words font-hand text-[26px] leading-[1.15] text-ink">
          {note.content}
        </p>
        <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-end justify-between font-retro text-[15px] leading-none text-ink/45">
          <span className="truncate" title={note.author}>
            {truncateAddress(note.author)}
          </span>
          <span className="ml-2 shrink-0">{timeAgo(note.timestamp)}</span>
        </div>
      </div>
    </motion.div>
  );
}
