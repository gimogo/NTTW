import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#F3EFE6",
        "note-yellow": "#FFF2A5",
        "note-pink": "#FFC5D0",
        "note-blue": "#AEE2FF",
        "note-green": "#C8FFD4",
        ink: "#2B2A26",
      },
      fontFamily: {
        hand: ["var(--font-hand)", "Caveat", "cursive"],
        retro: ["var(--font-retro)", "VT323", "monospace"],
      },
      boxShadow: {
        note: "2px 6px 14px rgba(60, 50, 30, 0.28), 0 1px 2px rgba(60, 50, 30, 0.2)",
        "note-hover": "4px 14px 26px rgba(60, 50, 30, 0.35), 0 2px 4px rgba(60, 50, 30, 0.22)",
        pin: "0 3px 5px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
