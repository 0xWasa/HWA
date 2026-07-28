"use client";

import { useEffect, useRef, useState } from "react";
import { DOCS_PARAM_SUMMARY, DOCS_SECTIONS } from "./docsContent";

export function DocsScreen() {
  const active = useActiveSection();

  return (
    <div className="mx-auto w-full max-w-[1280px] px-3 pb-24 pt-6 sm:px-6">
      <header className="max-w-[68ch] space-y-3">
        <div className="mlabel text-secondary-readable">Documentation</div>
        <h1 className="text-2xl font-semibold text-ink">How HWA works</h1>
        <p className="text-md leading-relaxed text-dim">
          NFTs deposited with HYPE backing, priced as one pool, allocated at random. This page describes the mechanics
          the contracts actually implement — the parameters below are the ones the app prices and settles with.
        </p>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:max-w-[68ch] lg:grid-cols-3">
        {DOCS_PARAM_SUMMARY.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-lg border border-line/60 bg-elevated/30 px-3.5 py-2.5"
          >
            <span className="text-xs text-mute">{label}</span>
            <span className="num font-mono text-sm font-semibold text-ink">{value}</span>
          </div>
        ))}
      </div>

      {/* ------------------------------------------- mobile / tablet nav */}
      <nav
        aria-label="Sections"
        className="sticky top-14 z-30 -mx-3 mt-8 overflow-x-auto border-y border-line bg-bg/92 px-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:hidden"
      >
        <ul className="flex w-max items-center gap-1 py-2">
          {DOCS_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? "true" : undefined}
                className={`block whitespace-nowrap rounded-sm px-2.5 py-2 text-xs font-medium transition-colors ${
                  active === s.id ? "bg-control text-accent" : "text-mute hover:text-dim"
                }`}
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8 flex gap-12">
        {/* ------------------------------------------------- desktop nav */}
        <nav aria-label="Sections" className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20">
            <div className="mlabel mb-3 text-mute">On this page</div>
            <ul className="space-y-0.5 border-l border-line">
              {DOCS_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={active === s.id ? "true" : undefined}
                    className={`-ml-px block border-l py-1.5 pl-3 text-sm transition-colors ${
                      active === s.id
                        ? "border-accent font-medium text-accent"
                        : "border-transparent text-mute hover:border-line-strong hover:text-dim"
                    }`}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        {/* ----------------------------------------------------- content */}
        <div className="min-w-0 flex-1">
          <div className="max-w-[68ch] space-y-16">
            {DOCS_SECTIONS.map((s) => (
              <section key={s.id} id={s.id} data-doc-section className="scroll-mt-32 lg:scroll-mt-20">
                <h2 className="text-xl font-semibold text-ink">{s.title}</h2>
                <p className="mt-1.5 text-sm text-mute">{s.lede}</p>
                <div className="mt-5 space-y-4">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Scroll-spy over the rendered sections. Falls back to the first section until
 * something crosses the reading line, so the nav is never left unmarked.
 */
function useActiveSection(): string {
  const firstId = DOCS_SECTIONS[0]?.id ?? "";
  const [active, setActive] = useState(firstId);
  const visible = useRef(new Set<string>());

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-doc-section]"));
    if (nodes.length === 0) return;

    const order = nodes.map((n) => n.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.current.add(entry.target.id);
          else visible.current.delete(entry.target.id);
        }
        const topMost = order.find((id) => visible.current.has(id));
        if (topMost) setActive(topMost);
      },
      // Reading line sits just under the sticky header.
      { rootMargin: "-88px 0px -70% 0px" },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return active;
}
