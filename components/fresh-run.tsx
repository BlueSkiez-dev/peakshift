"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, useAction } from "@/lib/client";
import { Button, Notice } from "./ui";
import { Dialog, useToast } from "./overlay";

/** Operator "Start a fresh run" — restores the seeded event so a judge can run the whole PayPal flow. */
export function FreshRun({ allowed, reason }: { allowed: boolean; reason: string }) {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAction();
  const toast = useToast();
  return (
    <>
      <Button variant="secondary" className="h-10" onClick={() => setOpen(true)} icon={<RotateCcw className="size-4" />}>
        Start a fresh run
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={allowed ? "Start a fresh run?" : "A run is in progress"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{allowed ? "Cancel" : "Close"}</Button>
            {allowed && (
              <Button
                variant="danger"
                loading={pending === "fresh"}
                loadingLabel="Restoring…"
                onClick={async () => {
                  const r = await run("fresh", () => api("demo/fresh-run", { body: {} }));
                  if (r) {
                    setOpen(false);
                    toast({ tone: "success", title: "Fresh run ready — the event is awaiting funding." });
                  }
                }}
              >
                Start fresh run
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3 text-[13px] text-ink-2">
          {allowed ? (
            <>
              <p>This restores the seeded event to <b className="text-ink">Awaiting funding</b> so you can run the whole flow yourself: fund via PayPal Checkout, plan, offers, verification, settlement and Payouts.</p>
              <p>The previous run’s plans, offers, settlement, payout records and audit trail are cleared. Sandbox transactions already sent to PayPal are not affected. The reset is audited.</p>
              <p className="text-[12px] text-ink-3">{reason}</p>
            </>
          ) : (
            <p>{reason}</p>
          )}
          {error && <Notice tone="danger" title={error.message} />}
        </div>
      </Dialog>
    </>
  );
}
