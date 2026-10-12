"use client";

import { useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useReadContracts,
  useWatchContractEvent,
} from "wagmi";
import {
  getNotesContractAddress,
  rawToNote,
  retroNotesAbi,
  type BoardNote,
  type RawNote,
} from "@/lib/contract";
import { DEMO_NOTES } from "@/lib/board";

/** Notes fetched per paginated eth_call. */
export const PAGE_SIZE = 50;
/** Safety cap: 40 pages x 50 = 2 000 notes fetched up front. */
const MAX_PAGES = 40;

type NoteCreatedArgs = {
  id: bigint;
  author: `0x${string}`;
  content: string;
  color: string;
  posX: number;
  posY: number;
  rotation: number;
  timestamp: bigint;
};

/**
 * Reads the wall: paginated `getNotes` calls for history, plus a live
 * `NoteCreated` event subscription so stamps from any wallet appear in
 * real time. Falls back to demo notes when no contract is configured.
 */
export function useNotes() {
  const chainId = useChainId();
  const { address: account } = useAccount();
  const contractAddress = getNotesContractAddress();
  const isLive = Boolean(contractAddress);

  // Notes observed through the event stream (real-time layer).
  const [liveNotes, setLiveNotes] = useState<BoardNote[]>([]);

  const {
    data: total,
    isLoading: isLoadingTotal,
    refetch: refetchTotal,
    error: totalError,
  } = useReadContract({
    address: contractAddress,
    abi: retroNotesAbi,
    functionName: "getTotalNotes",
    chainId,
    query: {
      enabled: isLive,
      refetchInterval: 20_000,
    },
  });

  const totalNumber = total !== undefined ? Number(total as bigint) : 0;

  const pageOffsets = useMemo(() => {
    const pageCount = Math.min(Math.ceil(totalNumber / PAGE_SIZE), MAX_PAGES);
    return Array.from({ length: pageCount }, (_, i) => i * PAGE_SIZE);
  }, [totalNumber]);

  const { data: pageResults, isLoading: isLoadingPages } = useReadContracts({
    contracts: pageOffsets.map((offset) => ({
      address: contractAddress as `0x${string}`,
      abi: retroNotesAbi,
      functionName: "getNotes" as const,
      args: [BigInt(offset), BigInt(PAGE_SIZE)] as const,
      chainId,
    })),
    query: {
      enabled: isLive && pageOffsets.length > 0,
    },
  });

  const historyNotes = useMemo<BoardNote[]>(() => {
    if (!pageResults) return [];
    const notes: BoardNote[] = [];
    for (const result of pageResults) {
      if (result.status !== "success") continue;
      for (const raw of result.result as readonly RawNote[]) {
        notes.push(rawToNote(raw));
      }
    }
    return notes;
  }, [pageResults]);

  // Live subscription — new stamps render instantly, from any author.
  useWatchContractEvent({
    address: contractAddress,
    abi: retroNotesAbi,
    eventName: "NoteCreated",
    chainId,
    enabled: isLive,
    onLogs(logs) {
      const incoming = logs.map((log) => {
        const args = log.args as unknown as NoteCreatedArgs;
        return {
          id: Number(args.id),
          author: args.author,
          content: args.content,
          color: args.color,
          posX: args.posX,
          posY: args.posY,
          rotation: args.rotation,
          timestamp: Number(args.timestamp),
        } satisfies BoardNote;
      });
      if (incoming.length === 0) return;
      setLiveNotes((prev) => {
        const byId = new Map(prev.map((n) => [n.id, n]));
        for (const note of incoming) byId.set(note.id, note);
        return [...byId.values()].sort((a, b) => a.id - b.id);
      });
      void refetchTotal();
    },
  });

  // Merge history + live events, dedupe by id, keep stack order (id = z-index).
  const notes = useMemo<BoardNote[]>(() => {
    const source: BoardNote[] = isLive ? [...historyNotes, ...liveNotes] : DEMO_NOTES;
    const byId = new Map<number, BoardNote>();
    for (const note of source) byId.set(note.id, note);
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }, [historyNotes, liveNotes, isLive]);

  const isLoading = isLive && (isLoadingTotal || (totalNumber > 0 && isLoadingPages));

  return {
    notes,
    total: isLive ? totalNumber : DEMO_NOTES.length,
    isLoading,
    contractAddress,
    isLive,
    account,
    error: totalError,
    refetch: () => {
      void refetchTotal();
    },
  };
}
