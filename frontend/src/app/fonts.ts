import { JetBrains_Mono, Manrope } from "next/font/google";

/**
 * Type system — two families, self-hosted by next/font
 * (no CLS, no external requests):
 *   Manrope        — display, UI and body copy
 *   JetBrains Mono — amounts, ids, hashes and market micro-labels
 */
export const fontSans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans-hwa",
  display: "swap",
});

export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono-hwa",
  display: "swap",
});

export const fontClassNames = `${fontSans.variable} ${fontMono.variable}`;
