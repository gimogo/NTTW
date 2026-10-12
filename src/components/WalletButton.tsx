"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import { ChevronDown, Loader2, LogOut, Wallet } from "lucide-react";
import { config } from "@/lib/wagmi";
import { truncateAddress } from "@/lib/board";

/**
 * Retro-styled wallet control: connect via any injected wallet (plus
 * WalletConnect when a project id is configured), then show the
 * truncated address with a disconnect dropdown.
 */
export default function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const chain = config.chains.find((c) => c.id === chainId);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (isConnected && address) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="retro-btn bg-[#C8FFD4]"
          title={address}
        >
          <Wallet className="h-4 w-4" />
          <span className="font-retro">{truncateAddress(address)}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
        {open && (
          <div className="retro-panel absolute right-0 top-full z-[100] mt-2 w-72 p-3">
            <p className="font-retro text-lg leading-none text-ink/50">
              CONNECTED · {(chain?.name ?? "UNKNOWN").toUpperCase()}
            </p>
            <p className="mt-2 break-all font-retro text-base leading-tight text-ink">
              {address}
            </p>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="retro-btn mt-3 w-full justify-center"
            >
              <LogOut className="h-4 w-4" /> Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="retro-btn"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Wallet className="h-4 w-4" />
        )}
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
      {open && (
        <div className="retro-panel absolute right-0 top-full z-[100] mt-2 w-72 p-2">
          <p className="px-2 pb-1 pt-1 font-retro text-lg leading-none text-ink/50">
            CHOOSE A WALLET
          </p>
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              type="button"
              onClick={() => {
                connect({ connector });
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-2 py-2 font-retro text-xl leading-none transition-colors hover:bg-note-yellow"
            >
              <span>{connector.name}</span>
              <span className="text-sm uppercase text-ink/40">
                {connector.type}
              </span>
            </button>
          ))}
          {error && (
            <p className="px-2 pb-1 pt-2 font-retro text-base leading-tight text-red-700">
              {error.message.split("\n")[0].slice(0, 140)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
