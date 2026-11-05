"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, useAction } from "@/lib/client";
import { Button, Notice } from "./ui";
import { Dialog, useToast } from "./overlay";

export function ResetDemo() {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAction();
  const toast = useToast();
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} icon={<RotateCcw className="size-4" />}>
        Reset demo scenario
      </Button>
      {error && <Notice tone="danger" className="mt-3" title={error.message} />}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reset the demo?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={pending === "reset"}
              loadingLabel="Resetting…"
              onClick={async () => {
                const r = await run("reset", () => api("admin/demo-reset", { body: {} }));
                setOpen(false);
                if (r) toast({ tone: "success", title: "Demo reset to the seeded scenario." });
              }}
            >
              Reset demo
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">This clears demo-generated plans, offers, meter readings, settlements and payout records, and restores the seeded event. Sandbox transactions already sent to PayPal are not affected. The reset is audited.</p>
      </Dialog>
    </>
  );
}
