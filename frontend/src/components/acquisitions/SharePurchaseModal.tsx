"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeLabel, shortAddress } from "@/lib/format";
import { formatHype, formatOddsPercent } from "@/lib/units";
import type { Listing } from "@/protocol/types";
import { Button } from "@/components/ui/Button";

const CARD_W = 1200;
const CARD_H = 630;

export function SharePurchaseModal({
  open,
  listing,
  requestId,
  paid,
  totalWeight,
  wallet,
  onClose,
}: {
  open: boolean;
  listing: Listing;
  requestId?: bigint;
  paid?: bigint;
  totalWeight?: bigint;
  wallet?: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRendering(true);
    setStatus(null);
    await drawPurchaseCard(canvas, { listing, requestId, paid, totalWeight, wallet });
    setRendering(false);
  }, [listing, requestId, paid, totalWeight, wallet]);

  useEffect(() => {
    if (!open) return;
    void render();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, render, onClose]);

  async function imageFile(): Promise<File | null> {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.94));
    return blob ? new File([blob], `hwa-purchase-${requestId?.toString() ?? listing.id.toString()}.png`, { type: "image/png" }) : null;
  }

  async function download() {
    const file = await imageFile();
    if (!file) {
      setStatus("Image export unavailable in this browser.");
      return;
    }
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Image downloaded.");
  }

  async function share() {
    const file = await imageFile();
    if (!file) return;
    const payload: ShareData = {
      title: "Hyper World Assets acquisition",
      text: `I drew ${sanitizeLabel(listing.nft.name, `NFT #${listing.tokenId}`)} on HyperEVM testnet.`,
      files: [file],
    };
    try {
      if (navigator.canShare?.(payload)) {
        await navigator.share(payload);
        setStatus("Shared.");
      } else {
        await navigator.clipboard.writeText(payload.text ?? "Hyper World Assets acquisition");
        setStatus("Share text copied. Download the image to attach it.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("Sharing was blocked. You can still download the image.");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-bg/90 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="share-purchase-title" data-testid="share-purchase-modal">
      <div className="card relative my-auto w-full max-w-4xl overflow-hidden rounded-2xl p-4 sm:p-6">
        <button type="button" onClick={onClose} aria-label="Close share preview" className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full border border-line bg-bg/80 text-mute hover:text-ink">×</button>
        <div className="pr-12">
          <div className="mlabel text-secondary-readable">SOCIAL CARD</div>
          <h2 id="share-purchase-title" className="mt-1 text-xl font-semibold text-ink">Share your draw</h2>
          <p className="mt-1 text-xs text-mute">Generated locally in your browser. No image or wallet data is uploaded.</p>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-line bg-black shadow-2xl">
          <canvas ref={canvasRef} width={CARD_W} height={CARD_H} className="block aspect-[1200/630] h-auto w-full" aria-label="Generated purchase card preview" />
        </div>

        {status && <p className="mt-3 text-center text-2xs text-chain" role="status">{status}</p>}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" size="lg" onClick={() => void download()} disabled={rendering} data-testid="download-purchase-card">Download PNG</Button>
          <Button variant="primary" size="lg" onClick={() => void share()} disabled={rendering} data-testid="share-purchase-card">{rendering ? "Preparing image…" : "Share"}</Button>
        </div>
      </div>
    </div>
  );
}

async function drawPurchaseCard(
  canvas: HTMLCanvasElement,
  input: {
    listing: Listing;
    requestId?: bigint;
    paid?: bigint;
    totalWeight?: bigint;
    wallet?: string;
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await document.fonts.ready;

  const { listing, requestId, paid, totalWeight, wallet } = input;
  const name = sanitizeLabel(listing.nft.name, `NFT #${listing.tokenId}`);
  const collection = sanitizeLabel(listing.nft.collectionName, "HyperEVM collection");
  const gradient = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  gradient.addColorStop(0, "#080A12");
  gradient.addColorStop(0.48, "#12142A");
  gradient.addColorStop(1, "#24175A");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glow = ctx.createRadialGradient(300, 315, 0, 300, 315, 390);
  glow.addColorStop(0, "rgba(216,255,82,.22)");
  glow.addColorStop(0.5, "rgba(80,210,193,.10)");
  glow.addColorStop(1, "rgba(115,84,245,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 720, CARD_H);

  ctx.strokeStyle = "rgba(216,255,82,.08)";
  ctx.lineWidth = 1;
  for (let x = 22; x < CARD_W; x += 34) {
    for (let y = 22; y < CARD_H; y += 34) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  roundRect(ctx, 64, 54, 438, 522, 32, "#0D101C", "rgba(216,255,82,.54)");
  const image = listing.nft.imageUrl ? await loadImage(listing.nft.imageUrl) : null;
  if (image) {
    coverImage(ctx, image, 82, 132, 402, 402, 24);
  } else {
    roundRect(ctx, 82, 132, 402, 402, 24, "#11182A", "rgba(80,210,193,.28)");
    drawOrbits(ctx, 283, 333);
  }

  ctx.fillStyle = "#D8FF52";
  ctx.font = "700 19px ui-monospace, monospace";
  ctx.fillText("HWA VERIFIED", 88, 91);
  ctx.fillStyle = "#A8AEC8";
  ctx.font = "500 16px ui-monospace, monospace";
  ctx.fillText(`#${listing.tokenId.toString()}  ·  LISTING ${listing.id.toString()}`, 88, 117);

  ctx.fillStyle = "#D8FF52";
  ctx.font = "800 24px ui-monospace, monospace";
  ctx.fillText("HYPER WORLD ASSETS", 570, 92);
  ctx.fillStyle = "#50D2C1";
  ctx.font = "600 18px ui-monospace, monospace";
  ctx.fillText("NFT ACQUIRED · HYPEREVM TESTNET", 570, 138);

  ctx.fillStyle = "#F5F6FF";
  ctx.font = "800 54px system-ui, sans-serif";
  wrapText(ctx, name, 570, 215, 560, 62, 2);
  ctx.fillStyle = "#A8AEC8";
  ctx.font = "500 25px system-ui, sans-serif";
  ctx.fillText(collection, 570, 322);

  const rows: [string, string][] = [
    ["BACKING", `${formatHype(listing.backing, { maxDecimals: 4 })} HYPE`],
    ["PAID", paid !== undefined ? `${formatHype(paid, { maxDecimals: 4 })} HYPE` : "ON-CHAIN"],
    ["ODDS", totalWeight && totalWeight > 0n ? formatOddsPercent(listing.weight, totalWeight) : "RECORDED"],
    ["PURCHASE", `#${requestId?.toString() ?? "—"}`],
  ];
  rows.forEach(([label, value], index) => {
    const y = 380 + index * 47;
    ctx.fillStyle = "#737B98";
    ctx.font = "600 16px ui-monospace, monospace";
    ctx.fillText(label, 570, y);
    ctx.fillStyle = index === 0 ? "#D8FF52" : "#F5F6FF";
    ctx.font = "700 20px ui-monospace, monospace";
    ctx.fillText(value, 760, y);
  });

  ctx.fillStyle = "#737B98";
  ctx.font = "500 15px ui-monospace, monospace";
  ctx.fillText(wallet ? `WALLET ${shortAddress(wallet, 7)}` : "VERIFIABLE ON-CHAIN DRAW", 570, 590);
  ctx.fillStyle = "#7354F5";
  ctx.fillRect(0, CARD_H - 8, CARD_W, 8);
  ctx.fillStyle = "#D8FF52";
  ctx.fillRect(0, CARD_H - 8, CARD_W * 0.42, 8);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function coverImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number, radius: number) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function drawOrbits(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  [62, 112, 162].forEach((radius, index) => {
    ctx.strokeStyle = index === 1 ? "rgba(80,210,193,.55)" : "rgba(115,84,245,.62)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = index === 1 ? "#D8FF52" : "#7354F5";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(index * 1.7) * radius, cy + Math.sin(index * 1.7) * radius, 8 - index, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#D8FF52";
  ctx.font = "900 96px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("?", cx, cy + 34);
  ctx.textAlign = "start";
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let lineIndex = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      line = word;
      lineIndex += 1;
      if (lineIndex >= maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (lineIndex < maxLines) ctx.fillText(line, x, y + lineIndex * lineHeight);
}
