"use client";

import { useEffect, useState } from "react";
import { timeLeft } from "@/lib/format";

/** Live "23h 12m" countdown to a unix-seconds deadline. */
export function Countdown({ until, prefix = "" }: { until: number; prefix?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="num font-mono">
      {prefix}
      {timeLeft(until)}
    </span>
  );
}
