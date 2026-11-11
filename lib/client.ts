"use client";
// Browser API helper. Returns the server's authoritative data or throws a typed error.
import { useCallback, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AS_HEADER, asPrefix, asUserId } from "./as";

/** Prefix a /business/... path so it stays inside the current tab-scoped business view, if any. */
export function useBizHref() {
  const prefix = asPrefix(usePathname());
  return (href: string) => (href.startsWith("/business") ? prefix + href : href);
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (init.body) headers["content-type"] = "application/json";
  const asId = typeof window !== "undefined" ? asUserId(window.location.pathname) : null;
  if (asId) headers[AS_HEADER] = asId; // tab-scoped business view acts as that business only
  try {
    res = await fetch(`/api/v1/${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    // Network failure: outcome unknown — callers must re-fetch authoritative state before retrying.
    throw new ApiError("NETWORK_UNCERTAIN", "Connection lost — we'll check the latest confirmed state before you retry.", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json?.error?.code ?? "ERROR", json?.error?.message ?? `Request failed (${res.status})`, res.status, json?.error?.fields);
  return json.data as T;
}

/** Run a mutation, then refresh server components so the page shows authoritative state. */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setPending(key);
      setError(null);
      try {
        const r = await fn();
        router.refresh();
        return r;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError("ERROR", (e as Error).message, 0);
        setError(err);
        router.refresh();
        return undefined;
      } finally {
        setPending(null);
      }
    },
    [router],
  );
  return { run, pending, error, setError };
}
