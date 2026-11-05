"use client";
// Dialog, side drawer and toasts. Dialogs trap focus, close on Escape and return focus to the trigger.
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose, cx } from "./ui";
import { Check, AlertTriangle, Info } from "lucide-react";

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])') ?? []);
    const first = focusables().find((el) => el.dataset.autofocus === "true") ?? focusables()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

const noopSubscribe = () => () => {};

function Portal({ children }: { children: ReactNode }) {
  const el = useSyncExternalStore(
    noopSubscribe,
    () => document.getElementById("ps-portal") ?? document.body,
    () => null,
  );
  return el ? createPortal(children, el) : null;
}

export function Dialog({ open, onClose, title, children, footer, size = "md", tone }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg"; tone?: "default" | "money" }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] anim-fade-up" onClick={onClose} aria-hidden />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dlg-title"
          className={cx(
            "relative w-full rounded-t-[16px] sm:rounded-[14px] border border-line-2 bg-surface shadow-2xl anim-scale-in max-h-[92vh] overflow-auto",
            { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" }[size],
            tone === "money" && "ring-1 ring-signal/25",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <h2 id="dlg-title" className="text-[16px] font-semibold tracking-[-0.01em]">
              {title}
            </h2>
            <IconClose onClick={onClose} />
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, width = 480 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number }) {
  const ref = useFocusTrap(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-40">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
        <div ref={ref} role="dialog" aria-modal="true" className="absolute right-0 top-0 h-full w-full overflow-auto border-l border-line-2 bg-surface shadow-2xl anim-slide-in" style={{ maxWidth: width }}>
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
            <div className="min-w-0">
              <div className="text-[16px] font-semibold tracking-[-0.01em]">{title}</div>
              {subtitle && <div className="mt-0.5 text-[12.5px] text-ink-2">{subtitle}</div>}
            </div>
            <IconClose onClick={onClose} />
          </div>
          <div className="px-5 py-5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ---------------------------------------------------------------- Toasts
type Toast = { id: number; tone: "success" | "error" | "info"; title: string; detail?: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "error" ? 8000 : 4800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-[10px] border border-line-2 bg-surface-2 px-4 py-3 shadow-xl anim-fade-up">
            <span className={cx("mt-0.5", t.tone === "success" ? "text-success" : t.tone === "error" ? "text-danger" : "text-info")}>
              {t.tone === "success" ? <Check className="size-4" /> : t.tone === "error" ? <AlertTriangle className="size-4" /> : <Info className="size-4" />}
            </span>
            <div className="min-w-0 text-[13px]">
              <div className="font-medium text-ink">{t.title}</div>
              {t.detail && <div className="mt-0.5 text-ink-2">{t.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
