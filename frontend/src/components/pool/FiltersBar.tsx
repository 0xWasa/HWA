"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CollectionInfo, ListingsQuery, RarityTier } from "@/protocol/types";
import { RARITY_LABEL, RARITY_ORDER } from "@/protocol/rarity";
import { Segmented } from "@/components/ui/Segmented";

export type ViewMode = "grid" | "list";

function FilterPopover({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex h-ctl items-center gap-1.5 rounded-sm border px-2.5 text-xs transition-colors ${
          count > 0 ? "border-accent/50 text-accent" : "border-line bg-control text-dim hover:text-ink"
        }`}
      >
        {label}
        {count > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-2xs font-semibold">{count}</span>}
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden>
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          className="anim-fade-up absolute left-0 top-9 z-40 w-56 rounded-md border border-line bg-elevated p-2"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-xs px-1.5 py-1 text-xs text-dim hover:bg-control">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-(--color-accent)" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </label>
  );
}

export function FiltersBar({
  query,
  onChange,
  collections,
  viewMode,
  onViewMode,
}: {
  query: ListingsQuery;
  onChange: (patch: Partial<ListingsQuery>) => void;
  collections: CollectionInfo[];
  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
}) {
  const toggle = <T,>(arr: T[] | undefined, v: T, on: boolean): T[] => {
    const set = new Set(arr ?? []);
    if (on) set.add(v);
    else set.delete(v);
    return [...set];
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-40">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <circle cx="5" cy="5" r="3.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 8l2.6 2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          aria-label="Search listings"
          placeholder="Search name, collection, #id"
          value={query.search ?? ""}
          onChange={(e) => onChange({ search: e.target.value || undefined, cursor: undefined })}
          className="h-ctl w-full rounded-sm border border-line bg-inset pl-7 pr-2.5 text-xs text-ink outline-none placeholder:text-faint focus:border-accent/60"
        />
      </div>

      <FilterPopover label="Collection" count={query.collections?.length ?? 0}>
        {collections
          .filter((c) => c.whitelisted)
          .map((c) => (
            <CheckRow
              key={c.address}
              checked={query.collections?.includes(c.address) ?? false}
              onChange={(on) => onChange({ collections: toggle(query.collections, c.address, on), cursor: undefined })}
            >
              {c.name}
            </CheckRow>
          ))}
      </FilterPopover>

      <FilterPopover label="Rarity" count={query.rarities?.length ?? 0}>
        {RARITY_ORDER.map((tier: RarityTier) => (
          <CheckRow
            key={tier}
            checked={query.rarities?.includes(tier) ?? false}
            onChange={(on) => onChange({ rarities: toggle(query.rarities, tier, on), cursor: undefined })}
          >
            {RARITY_LABEL[tier]}
          </CheckRow>
        ))}
      </FilterPopover>

      <div className="ml-auto flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-2xs text-mute">
          Sort
          <select
            aria-label="Sort listings"
            value={`${query.sort}:${query.direction}`}
            onChange={(e) => {
              const [sort, direction] = e.target.value.split(":") as [ListingsQuery["sort"], ListingsQuery["direction"]];
              onChange({ sort, direction });
            }}
            className="h-ctl rounded-sm border border-line bg-control px-2 text-xs text-ink outline-none focus:border-accent/60"
          >
            <option value="value:desc">Value ↓</option>
            <option value="value:asc">Value ↑</option>
            <option value="date:desc">Newest</option>
            <option value="date:asc">Oldest</option>
            <option value="odds:desc">Odds ↓</option>
            <option value="odds:asc">Odds ↑</option>
            <option value="name:asc">Name A–Z</option>
          </select>
        </label>
        <Segmented
          ariaLabel="Layout"
          value={viewMode}
          onChange={onViewMode}
          options={[
            { value: "grid", label: "Grid" },
            { value: "list", label: "List" },
          ]}
        />
      </div>
    </div>
  );
}
