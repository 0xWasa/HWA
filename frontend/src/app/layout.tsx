import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import "./globals.css";
import { fontClassNames } from "./fonts";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: "Hyper World Assets",
  description:
    "Randomized NFT acquisition protocol on HyperEVM — deposit NFTs with HYPE backing, acquire random positions, settle on your terms.",
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
