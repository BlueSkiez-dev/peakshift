"use client";
// Charts render client-only (canvas). A sized skeleton keeps layout stable while they load.
import dynamic from "next/dynamic";

const Skel = ({ h = 280 }: { h?: number }) => <div className="w-full animate-pulse rounded-[8px] bg-surface-2/70" style={{ height: h }} aria-hidden />;

export const DemandChart = dynamic(() => import("./charts").then((m) => m.DemandChart), { ssr: false, loading: () => <Skel h={300} /> });
export const SpecChart = dynamic(() => import("./charts").then((m) => m.SpecChart), { ssr: false, loading: () => <Skel h={260} /> });
