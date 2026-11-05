import { pageUser } from "@/lib/auth";
import { readFresh } from "@/lib/store";
import { maskEmail } from "@/lib/format";
import { recipientFor } from "@/lib/recipients";
import { KV } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Profile() {
  const u = await pageUser();
  const s = (await readFresh());
  const org = s.orgs.find((o) => o.id === u.orgId)!;
  return (
    <div className="space-y-5">
      <h1 className="text-[26px] font-semibold tracking-[-0.025em]">Profile</h1>
      <section className="rounded-[14px] border border-line bg-surface px-5 py-2">
        <dl className="divide-y divide-line">
          <KV k="Business" v={org.name} />
          <KV k="Category" v={org.category} />
          <KV k="Site" v={org.siteLabel} />
          <KV k="Timezone" v="Africa/Lagos (WAT)" />
          <KV k="Owner" v={u.displayName} />
          <KV k="PayPal payout recipient" v={maskEmail(recipientFor(org))} mono />
        </dl>
      </section>
      <p className="text-[12.5px] text-ink-3">This is a fictional demo business. Payouts go to a PayPal sandbox recipient — no real money moves.</p>
    </div>
  );
}
