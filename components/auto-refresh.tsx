"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetch authoritative server state while something is still processing. */
export function AutoRefresh({ active, ms = 3000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
