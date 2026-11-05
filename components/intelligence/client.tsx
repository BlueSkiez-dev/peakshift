"use client";
import dynamic from "next/dynamic";
import type { StudioBootstrap } from "@/lib/analytics-contract";
import type { Dataset, DatasetName } from "@/lib/analytics";
import type { StudioReport } from "@/lib/types";
import { AskPanel } from "../analytics-workspace";

const Workspace = dynamic(() => import("./workspace"), {
  ssr: false,
  loading: () => (
    <div className="space-y-3" aria-busy="true">
      <div className="h-12 animate-pulse rounded-[12px] bg-surface-2/70" />
      <div className="grid h-[720px] place-items-center rounded-[14px] border border-line bg-surface text-[13px] text-ink-3">Loading Energy Intelligence…</div>
    </div>
  ),
});

export function IntelligenceClient(props: { bootstrap: StudioBootstrap; report: StudioReport; ai: boolean; licenseKey: string | null; canEdit: boolean; offlineDatasets: Record<DatasetName, Dataset> | null }) {
  const { offlineDatasets, ...rest } = props;
  if (!offlineDatasets) return <Workspace {...rest} />;
  return (
    <div className="grid gap-4 2xl:grid-cols-[1fr_400px]">
      <div className="min-w-0">
        <Workspace {...rest} />
      </div>
      <AskPanel eventId={props.bootstrap.eventId} datasets={offlineDatasets} />
    </div>
  );
}
