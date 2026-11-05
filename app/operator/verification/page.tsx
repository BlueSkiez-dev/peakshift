import { redirect } from "next/navigation";
import { readFresh } from "@/lib/store";
import { activeEvent } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Verification() {
  const s = (await readFresh());
  const ev = s.events.find((e) => e.verificationRunId) ?? activeEvent(s);
  redirect(ev ? `/operator/events/${ev.id}?stage=${ev.verificationRunId ? "verify" : "execute"}` : "/operator/events");
}
