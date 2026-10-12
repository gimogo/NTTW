"use client";

import dynamic from "next/dynamic";

/**
 * The board is entirely client-rendered. Loading it with `ssr: false` keeps
 * wagmi/viem hooks (useChainId, useReadContract, event watchers) out of Next's
 * build-time static prerender, where there is no wallet or RPC available.
 */
const BoardScreen = dynamic(() => import("@/components/BoardScreen"), {
  ssr: false,
  loading: () => (
    <div className="page-bg flex h-screen items-center justify-center">
      <div className="retro-panel px-8 py-6 text-center">
        <p className="font-retro text-3xl uppercase leading-none tracking-wide">
          📌 Pinning the corkboard…
        </p>
        <p className="mt-2 font-hand text-2xl text-ink/60">
          loading the wall
        </p>
      </div>
    </div>
  ),
});

export default function HomePage() {
  return <BoardScreen />;
}
