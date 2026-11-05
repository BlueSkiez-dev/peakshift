import { PageHeader } from "@/components/ui";
import { EventWizard } from "@/components/event-wizard";
import { claudeEnabled } from "@/lib/ai/claude";
import { paypalMode } from "@/lib/paypal";

export default function NewEvent() {
  return (
    <div className="mx-auto max-w-[1080px]">
      <PageHeader eyebrow="Events / New" title="Create event" desc="Define the need in plain language or fill the fields directly. Nothing is saved, published or funded without your confirmation." />
      <EventWizard ai={claudeEnabled() ? "claude" : "offline"} paypal={paypalMode()} />
    </div>
  );
}
