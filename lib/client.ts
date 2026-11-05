"use client";
// Browser API helper. Returns the server's authoritative data or throws a typed error.
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

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
  try {
    res = await fetch(`/api/v1/${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: init.body ? { "content-type": "application/json" } : undefined,
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
