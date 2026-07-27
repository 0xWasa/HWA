import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Production VPS images use Next's self-contained server output. Local dev/builds keep their
  // existing layout so the running port 3900 session is never disturbed by a release build.
  output: process.env.NEXT_OUTPUT_MODE === "standalone" ? "standalone" : undefined,
  // Production builds write to their own directory. Sharing `.next` with a
  // running dev server corrupts it mid-session ("Cannot find module './NNN.js'"),
  // which is easy to trigger and confusing to diagnose.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Pin the tracing root to this package: stray lockfiles higher up the disk
  // must not change what Next considers the workspace.
  outputFileTracingRoot: path.join(__dirname),
  // NFT images come from untrusted, indexer-provided URLs (or data: URIs in mock
  // mode). They are rendered through the sandboxed <NFTImage> component with plain
  // <img>, so the Next image optimizer is not used at all.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
