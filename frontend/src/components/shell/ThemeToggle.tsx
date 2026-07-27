"use client";

import { useEffect, useState } from "react";

/** Light/dark toggle, fwa.fun-style ghost icon button. Dark is the default. */
export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("hwa.theme", next ? "light" : "dark");
    } catch {
      // preference simply won't persist
    }
  };

  return (
    <button
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      className="grid size-9 place-items-center rounded-md text-mute transition-colors hover:bg-control hover:text-ink"
    >
      {light ? (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <path
            d="M13 8.5A5.5 5.5 0 1 1 6.5 2a4.3 4.3 0 0 0 6.5 6.5Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
          <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M7.5 .8v1.9M7.5 12.3v1.9M.8 7.5h1.9M12.3 7.5h1.9M2.8 2.8l1.3 1.3M10.9 10.9l1.3 1.3M12.2 2.8l-1.3 1.3M4.1 10.9l-1.3 1.3"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
