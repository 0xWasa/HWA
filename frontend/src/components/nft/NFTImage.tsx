"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Untrusted NFT image rendering:
 *  - plain <img> (no Next optimizer), stable square ratio, no layout shift
 *  - loading skeleton, hard timeout, graceful fallback on error/missing
 *  - never renders metadata as HTML; alt text is sanitized upstream
 */
export function NFTImage({
  src,
  alt,
  className = "",
  timeoutMs = 8_000,
  rounded = true,
}: {
  src?: string;
  alt: string;
  className?: string;
  timeoutMs?: number;
  rounded?: boolean;
}) {
  const [state, setState] = useState<"loading" | "ok" | "failed">(src ? "loading" : "failed");
  // data: URIs decode locally: they either render or error instantly, so they
  // get eager loading and no network timeout (a lazy-deferred image in a
  // hidden/uncomposited tab would otherwise be misread as broken).
  const isDataUri = src?.startsWith("data:") ?? false;
  const boxRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    setState(src ? "loading" : "failed");
    setInView(false);
  }, [src]);

  // A lazy image below the fold is never fetched, so it never fires onLoad.
  // Arming the timeout regardless marked every off-screen NFT as offline media
  // after 8s, permanently: the fallback unmounts the img, so scrolling to it
  // could not recover. The clock starts only once the image is near the
  // viewport and the browser has a reason to load it.
  useEffect(() => {
    if (!src || isDataUri) return;
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(box);
    return () => io.disconnect();
  }, [src, isDataUri]);

  useEffect(() => {
    if (!src || isDataUri || !inView) return;
    const t = setTimeout(() => {
      setState((s) => (s === "loading" ? "failed" : s));
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [src, isDataUri, inView, timeoutMs]);

  return (
    <div
      ref={boxRef}
      className={`relative aspect-square w-full select-none overflow-hidden bg-inset ${
        rounded ? "rounded-sm" : ""
      } ${className}`}
    >
      {state === "loading" && <div className="skeleton absolute inset-0 rounded-none" aria-hidden />}
      {src && state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading={isDataUri ? "eager" : "lazy"}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setState("ok")}
          onError={() => setState("failed")}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${
            state === "ok" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {state === "failed" && (
        <div
          className="nft-fallback absolute inset-0 grid place-items-center"
          role="img"
          aria-label={`${alt || "NFT"} (image unavailable)`}
        >
          <div aria-hidden className="nft-fallback-orbit" />
          <div className="relative flex flex-col items-center gap-1.5 text-faint">
            <span aria-hidden className="grid size-8 rotate-45 place-items-center rounded-md border border-accent/30 bg-bg/50 shadow-lg">
              <span className="size-2 -rotate-45 rounded-[2px] bg-accent/70" />
            </span>
            <span className="mlabel mt-1 text-3xs tracking-[0.16em] text-mute">NFT / MEDIA OFFLINE</span>
          </div>
        </div>
      )}
    </div>
  );
}
