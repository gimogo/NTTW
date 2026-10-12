"use client";

import { useCallback, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import Header from "@/components/Header";
import Board, { type Placement } from "@/components/Board";
import NoteComposer from "@/components/NoteComposer";
import { useNotes } from "@/hooks/useNotes";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_WIDTH,
  clamp,
} from "@/lib/board";

/**
 * The interactive corkboard screen. Loaded client-only (see page.tsx) so its
 * wagmi hooks never run during Next's build-time static prerender.
 */
export default function BoardScreen() {
  const { notes, total, isLoading, refetch } = useNotes();

  const [placing, setPlacing] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const startPlacing = useCallback(() => {
    setComposerOpen(false);
    setPlacing(true);
    setPlacement((prev) => {
      if (prev) return prev;
      // Drop the ghost near the middle of the wall, with a little jitter.
      const jitter = () => Math.round((Math.random() - 0.5) * 220);
      return {
        x: clamp(
          Math.round(BOARD_WIDTH / 2 - NOTE_WIDTH / 2) + jitter(),
          0,
          BOARD_WIDTH - NOTE_WIDTH
        ),
        y: clamp(
          Math.round(BOARD_HEIGHT / 2 - NOTE_MIN_HEIGHT / 2) + jitter(),
          0,
          BOARD_HEIGHT - NOTE_MIN_HEIGHT - 40
        ),
      };
    });
  }, []);

  const handleStamped = useCallback(() => {
    setComposerOpen(false);
    setPlacing(false);
    refetch();
  }, [refetch]);

  return (
    <div className="page-bg flex h-screen flex-col overflow-hidden">
      <Header totalNotes={total} />

      <main className="relative flex-1 overflow-hidden">
        {/* Placement hint */}
        {placing && (
          <div className="pointer-events-none absolute left-1/2 bottom-4 z-[250000] -translate-x-1/2">
            <div className="border-2 border-ink bg-cream px-3 py-1 font-retro text-lg uppercase leading-none shadow-[3px_3px_0_#2B2A26]">
              Drag the ghost note, then click it to write
            </div>
          </div>
        )}

        <Board
          notes={notes}
          isLoading={isLoading}
          placing={placing}
          placement={placement}
          onPlacementChange={setPlacement}
          onPlaceConfirm={() => setComposerOpen(true)}
        />
      </main>

      {/* Floating Action Button */}
      <button
        type="button"
        onClick={startPlacing}
        className="retro-btn retro-btn-fixed fixed bottom-6 right-6 z-[290000] px-5 py-2 text-2xl"
      >
        <Plus className="h-6 w-6" strokeWidth={3} /> Stamp Note
      </button>

      <AnimatePresence>
        {composerOpen && placement && (
          <NoteComposer
            position={placement}
            onClose={() => {
              setComposerOpen(false);
              setPlacing(false);
            }}
            onMove={startPlacing}
            onStamped={handleStamped}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
