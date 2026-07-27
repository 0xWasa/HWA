/**
 * Deterministic generative SVG art for mock NFTs — self-contained data URIs,
 * no network fetches, stable per (collection, tokenId). Obviously synthetic:
 * mock assets are placeholders for the real HyperEVM collections and must
 * never be mistaken for their actual artwork.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Motif = "cat" | "orbs" | "shards" | "grid" | "waves" | "rings" | "drop";

export interface CollectionArtTheme {
  bg: string;
  tones: string[];
  motif: Motif;
}

/** Hyperliquid-family palettes, one per ecosystem collection. */
export const ART_THEMES: Record<string, CollectionArtTheme> = {
  HYPURR: { bg: "#14343a", tones: ["#50d2c1", "#97fce4", "#2f9e8f", "#6fe0d2"], motif: "cat" },
  HYPIO: { bg: "#17263f", tones: ["#7fb6ec", "#a9d4ff", "#3f6ea8", "#5f93cc"], motif: "orbs" },
  PIP: { bg: "#17392a", tones: ["#5fc7a6", "#a8f0c8", "#2e7a5c", "#7fdcbb"], motif: "drop" },
  HYPERS: { bg: "#123239", tones: ["#50d2c1", "#f5c34b", "#2b6f68", "#3fb5a8"], motif: "rings" },
  MADKIN: { bg: "#3a2c16", tones: ["#f5c34b", "#ffe1a0", "#9c7833", "#c9a04f"], motif: "shards" },
  DRIP: { bg: "#2e1d40", tones: ["#b48edc", "#e0c9ff", "#6b4a94", "#8f6fc0"], motif: "grid" },
};

function hashSeed(symbol: string, tokenId: bigint): number {
  let h = 2166136261;
  const s = `${symbol}#${tokenId.toString()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Geometric cat head — an original nod to the Hyperliquid mascot, not its art. */
function catFace(rnd: () => number, tones: string[], S: number): string {
  const c = S / 2;
  const fur = tones[0]!;
  const light = tones[1]!;
  const dark = tones[2]!;
  const r = S * (0.24 + rnd() * 0.03);
  const earH = r * 0.9;
  const eyeY = c - r * 0.15;
  const eyeDx = r * 0.42;
  const eyeR = r * (0.13 + rnd() * 0.05);
  const blink = rnd() < 0.18;
  const parts: string[] = [];
  // ears
  parts.push(
    `<polygon points="${c - r * 0.85},${c - r * 0.45} ${c - r * 0.72},${c - r * 0.45 - earH} ${c - r * 0.15},${c - r * 0.72}" fill="${fur}"/>`,
    `<polygon points="${c + r * 0.85},${c - r * 0.45} ${c + r * 0.72},${c - r * 0.45 - earH} ${c + r * 0.15},${c - r * 0.72}" fill="${fur}"/>`,
  );
  // head
  parts.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="${fur}"/>`);
  // eyes
  if (blink) {
    parts.push(
      `<path d="M${c - eyeDx - eyeR} ${eyeY} q ${eyeR} ${eyeR * 0.9} ${eyeR * 2} 0" stroke="${dark}" stroke-width="${S * 0.012}" fill="none" stroke-linecap="round"/>`,
      `<path d="M${c + eyeDx - eyeR} ${eyeY} q ${eyeR} ${eyeR * 0.9} ${eyeR * 2} 0" stroke="${dark}" stroke-width="${S * 0.012}" fill="none" stroke-linecap="round"/>`,
    );
  } else {
    parts.push(
      `<circle cx="${c - eyeDx}" cy="${eyeY}" r="${eyeR}" fill="${dark}"/>`,
      `<circle cx="${c + eyeDx}" cy="${eyeY}" r="${eyeR}" fill="${dark}"/>`,
      `<circle cx="${c - eyeDx + eyeR * 0.3}" cy="${eyeY - eyeR * 0.3}" r="${eyeR * 0.32}" fill="${light}"/>`,
      `<circle cx="${c + eyeDx + eyeR * 0.3}" cy="${eyeY - eyeR * 0.3}" r="${eyeR * 0.32}" fill="${light}"/>`,
    );
  }
  // nose + whiskers
  parts.push(
    `<polygon points="${c},${c + r * 0.26} ${c - r * 0.09},${c + r * 0.14} ${c + r * 0.09},${c + r * 0.14}" fill="${dark}"/>`,
  );
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = c + r * (0.1 + i * 0.14);
      parts.push(
        `<line x1="${c + dir * r * 0.3}" y1="${y}" x2="${c + dir * r * (1.15 + rnd() * 0.15)}" y2="${y - r * 0.12 + i * r * 0.1}" stroke="${light}" stroke-width="${S * 0.008}" stroke-linecap="round" opacity="0.75"/>`,
      );
    }
  }
  return parts.join("");
}

export function nftArtDataUri(symbol: string, tokenId: bigint): string {
  const theme = ART_THEMES[symbol] ?? ART_THEMES.HYPURR!;
  const rnd = mulberry32(hashSeed(symbol, tokenId));
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;
  const S = 320;
  const parts: string[] = [];

  parts.push(`<rect width="${S}" height="${S}" fill="${theme.bg}"/>`);

  if (theme.motif === "cat") {
    // soft backdrop wash, then the mascot
    for (let i = 0; i < 3; i++) {
      parts.push(
        `<circle cx="${(rnd() * S).toFixed(0)}" cy="${(rnd() * S).toFixed(0)}" r="${(50 + rnd() * 90).toFixed(0)}" fill="${pick(theme.tones)}" opacity="0.2"/>`,
      );
    }
    parts.push(catFace(rnd, theme.tones, S));
  } else {
    const count = 6 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const c = pick(theme.tones);
      const o = 0.55 + rnd() * 0.4;
      if (theme.motif === "orbs") {
        const r = 18 + rnd() * 70;
        parts.push(
          `<circle cx="${(rnd() * S).toFixed(0)}" cy="${(rnd() * S).toFixed(0)}" r="${r.toFixed(0)}" fill="${c}" opacity="${o.toFixed(2)}"/>`,
        );
      } else if (theme.motif === "rings") {
        const r = 24 + rnd() * 90;
        parts.push(
          `<circle cx="${(S / 2 + (rnd() - 0.5) * 90).toFixed(0)}" cy="${(S / 2 + (rnd() - 0.5) * 90).toFixed(0)}" r="${r.toFixed(0)}" fill="none" stroke="${c}" stroke-width="${(3 + rnd() * 10).toFixed(0)}" opacity="${o.toFixed(2)}"/>`,
        );
      } else if (theme.motif === "shards") {
        const x = rnd() * S;
        const y = rnd() * S;
        const pts = `${x},${y} ${x + rnd() * 120 - 60},${y + rnd() * 120} ${x + rnd() * 120},${y + rnd() * 60 - 30}`;
        parts.push(`<polygon points="${pts}" fill="${c}" opacity="${o.toFixed(2)}"/>`);
      } else if (theme.motif === "grid") {
        const size = 22 + rnd() * 40;
        const x = Math.floor((rnd() * S) / size) * size;
        const y = Math.floor((rnd() * S) / size) * size;
        parts.push(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${c}" opacity="${o.toFixed(2)}"/>`);
      } else if (theme.motif === "drop") {
        // teardrop / pip
        const x = 50 + rnd() * (S - 100);
        const y = 50 + rnd() * (S - 110);
        const r = 30 + rnd() * 52;
        parts.push(
          `<path d="M${x} ${y - r} q ${r} ${r} 0 ${r * 1.7} q ${-r} ${-r * 0.7} 0 ${-r * 1.7}" fill="${c}" opacity="${o.toFixed(2)}"/>`,
        );
      } else {
        const y = rnd() * S;
        const amp = 12 + rnd() * 30;
        parts.push(
          `<path d="M0 ${y.toFixed(0)} Q ${S / 4} ${(y - amp).toFixed(0)}, ${S / 2} ${y.toFixed(0)} T ${S} ${y.toFixed(0)}" fill="none" stroke="${c}" stroke-width="${(4 + rnd() * 8).toFixed(0)}" opacity="${o.toFixed(2)}"/>`,
        );
      }
    }
  }

  parts.push(
    `<text x="${S - 12}" y="${S - 12}" text-anchor="end" font-family="monospace" font-size="20" fill="#f6fefd" opacity="0.8">#${tokenId.toString()}</text>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${parts.join("")}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
