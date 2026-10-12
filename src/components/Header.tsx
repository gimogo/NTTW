"use client";

import { useChainId } from "wagmi";
import WalletButton from "./WalletButton";
import { config } from "@/lib/wagmi";

/** Retro header: title plate, live note counter, chain badge, wallet. */
export default function Header({ totalNotes }: { totalNotes?: number }) {
  const chainId = useChainId();
  const chain = config.chains.find((c) => c.id === chainId);

  return (
    <header className="z-50 flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink bg-cream/95 px-4 py-2 shadow-[0_2px_0_rgba(43,42,38,0.15)]">
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none" aria-hidden>
          📌
        </span>
        <div>
          <h1 className="font-retro text-2xl uppercase leading-none tracking-[0.12em] md:text-3xl">
            Notes{" "}
            <span className="bg-[#FFD84D] px-1 shadow-[2px_2px_0_#2B2A26]">
              To The
            </span>{" "}
            World
          </h1>
          <p className="mt-1 font-retro text-base leading-none text-ink/50">
            decentralized corkboard · every note minted as an ERC-721 ·{" "}
            {totalNotes !== undefined ? `${totalNotes} notes stamped` : "…"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {chain && (
          <span className="hidden font-retro text-lg leading-none text-ink/60 md:inline">
            [{chain.name.toUpperCase()}]
          </span>
        )}
        <WalletButton />
      </div>
    </header>
  );
}
