import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import "./globals.css";
import { fontClassNames } from "./fonts";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://hwa.fun"),
  title: {
    default: "HWA",
    template: "%s | HWA",
  },
  description:
    "Randomized NFT acquisition protocol on HyperEVM — deposit NFTs with HYPE backing, acquire random positions, settle on your terms.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "HWA",
    title: "HWA",
    description: "NFT liquidity, drawn on HyperEVM.",
    images: [
      {
        url: "/brand/hwa-banner.png",
        width: 1500,
        height: 500,
        alt: "HWA",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "HWA",
    description: "NFT liquidity, drawn on HyperEVM.",
    images: ["/brand/hwa-banner.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#080a12",
  width: "device-width",
  initialScale: 1,
};

/** Applies the persisted theme before paint (dark is the default). */
const themeInit = `try{if(localStorage.getItem("hwa.theme")==="light")document.documentElement.classList.add("light")}catch{}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={fontClassNames} suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="app-backdrop min-h-dvh">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
