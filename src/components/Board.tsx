"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import StickyNote from "./StickyNote";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_WIDTH,
  clamp,
} from "@/lib/board";
import type { BoardNote } from "@/lib/contract";

export type Placement = { x: number; y: number };

type Props = {
  notes: BoardNote[];
  isLoading?: boolean;
  placing: boolean;
  placement: Placement | null;
  onPlacementChange: (pos: Placement) => void;
  onPlaceConfirm: () => void;
};

/** Base stacking order for the oldest note; newer notes sit on top. */
const BASE_Z = 10;

/**
 * The corkboard: a large scrollable canvas with absolutely positioned,
 * overlapping notes. Newest note ids stack highest; hovering peels the
 * top note back to reveal what's underneath.
 */
export default function Board({
  notes,
  isLoading,
  placing,
  placement,
  onPlacementChange,
  onPlaceConfirm,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [frontId, setFrontId] = useState<number | null>(null);

  // Start centered on the wall so the middle of the canvas is visible.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, BOARD_WIDTH / 2 - el.clientWidth / 2);
    el.scrollTop = Math.max(0, BOARD_HEIGHT / 2 - el.clientHeight / 2);
  }, []);

  return (
    <div ref={scrollRef} className="board-scroll h-full w-full overflow-auto">
      <div
        className="relative m-6"
        style={{
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          maxWidth: "none",
        }}
      >
        <div
          ref={surfaceRef}
          className="corkboard relative h-full w-full rounded-[6px] border-2 border-ink/25 shadow-[inset_0_0_60px_rgba(60,50,30,0.18),0_10px_40px_rgba(60,50,30,0.18)]"
        >
          {/* Empty-state placard */}
          {!isLoading && notes.length === 0 && !placing && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="retro-panel max-w-md p-6 text-center">
                <p className="font-retro text-2xl uppercase leading-none">
                  The wall is empty
                </p>
                <p className="mt-3 font-hand text-2xl leading-tight text-ink/70">
                  Be the first to pin something here — hit{" "}
                  <span className="bg-[#FFD84D] px-1 font-retro text-xl">
                    + Sticky Note
                  </span>{" "}
                  and stamp it on-chain.
                </p>
              </div>
            </div>
          )}

          {/* Notes — z-index grows with id (newest on top) */}
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              z={BASE_Z + note.id * 2 + (frontId === note.id ? 4000 : 0)}
              onClick={(id) => setFrontId(id)}
            />
          ))}

          {/* Draggable ghost note for placement mode */}
          {placing && placement && (
            <motion.div
              key={`ghost-${placement.x}-${placement.y}`}
              drag
              dragConstraints={surfaceRef}
              dragMomentum={false}
              dragElastic={0}
              onDragEnd={(_, info) => {
                onPlacementChange({
                  x: Math.round(
                    clamp(
                      placement.x + info.offset.x,
                      0,
                      BOARD_WIDTH - NOTE_WIDTH
                    )
                  ),
                  y: Math.round(
                    clamp(
                      placement.y + info.offset.y,
                      0,
                      BOARD_HEIGHT - NOTE_MIN_HEIGHT - 40
                    )
                  ),
                });
              }}
              onClick={onPlaceConfirm}
              className="absolute z-[200000] cursor-grab active:cursor-grabbing"
              style={{ left: placement.x, top: placement.y, width: NOTE_WIDTH }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
            >
              <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 -rotate-2">
                <div className="h-7 w-24 rounded-[2px] border-2 border-dashed border-ink/50 bg-white/40" />
              </div>
              <div
                className="rounded-[3px] border-[3px] border-dashed border-ink/60 bg-note-yellow/85 px-4 pb-9 pt-7 shadow-note"
                style={{ minHeight: NOTE_MIN_HEIGHT }}
              >
                <p className="font-hand text-[26px] leading-[1.15] text-ink/50">
                  drag me around the wall…
                </p>
                <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-end justify-between font-retro text-[15px] leading-none text-ink/45">
                  <span>you</span>
                  <span>now</span>
                </div>
              </div>
              <div className="mt-2 w-fit -translate-x-1/2 translate-x-2 whitespace-nowrap border-2 border-ink bg-cream px-2 py-[2px] font-retro text-lg leading-none shadow-[2px_2px_0_#2B2A26]">
                X:{placement.x} Y:{placement.y} — CLICK TO WRITE
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
