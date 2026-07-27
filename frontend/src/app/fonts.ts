import { JetBrains_Mono, Manrope, Sora } from "next/font/google";

/**
 * Type system — three cuts with actual character, self-hosted by next/font
 * (no CLS, no external requests):
 *   Sora          — display: wordmark, page titles, hero numbers
 *   Manrope       — UI/body: dense interface text, copy
 *   JetBrains Mono— data: amounts, ids, hashes, mono micro-labels
 */
export const fontDisplay = Sora({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export const fontSans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-hwa",
  display: "swap",
});

export const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono-hwa",
  display: "swap",
});

export const fontClassNames = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`;
