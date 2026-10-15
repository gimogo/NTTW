import type { Metadata, Viewport } from "next";
import { Caveat, VT323 } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-hand",
  display: "swap",
});

const vt323 = VT323({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-retro",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://imd-retro-wall.vercel.app"),
  title: "Notes To The World — On-chain Sticky Notes as NFTs",
  description:
    "A decentralized, permanent sticky-note corkboard on Robinhood Chain. Every note is stamped on-chain and minted as a unique ERC-721 NFT.",
  // Twitter / X summary-large card
  twitter: {
    card: "summary_large_image",
    title: "Notes To The World — On-chain Sticky Notes as NFTs",
    description:
      "Stamp a note on a retro corkboard. Each note is minted as an ERC-721 NFT on Robinhood Chain.",
  },
  openGraph: {
    type: "website",
    title: "Notes To The World — On-chain Sticky Notes as NFTs",
    description:
      "Stamp a note on a retro corkboard. Each note is minted as an ERC-721 NFT on Robinhood Chain.",
    siteName: "Notes To The World",
  },
};

export const viewport: Viewport = {
  themeColor: "#F3EFE6",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${caveat.variable} ${vt323.variable}`}>
      <body className="font-retro">
        {/* WagmiProvider + QueryClientProvider: every wagmi hook (useChainId,
            useAccount, useReadContract, ...) in the tree must sit under this. */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
