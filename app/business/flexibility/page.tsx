import { pageUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { latestProfile } from "@/lib/services";
import { claudeEnabled } from "@/lib/ai/claude";
import { recentlyConfirmed } from "@/lib/business-view";
import { scenarioNowMs } from "@/lib/clock";
import { ProfileBuilder } from "@/components/profile-builder";

export const dynamic = "force-dynamic";

export default async function Flexibility() {
  const u = await pageUser();
  const s = (await readFresh());
  const org = s.orgs.find((o) => o.id === u.orgId)!;
  const confirmed = latestProfile(s, org.id, "confirmed") ?? null;
  const draft = s.profiles.find((p) => p.orgId === org.id && p.status === "draft") ?? null;
  return <ProfileBuilder key={draft?.id ?? confirmed?.id ?? "none"} orgId={org.id} orgName={org.name} confirmed={confirmed} draft={draft} justConfirmed={!draft && recentlyConfirmed(confirmed, scenarioNowMs(s))} ai={claudeEnabled() ? "claude" : "offline"} />;
}
