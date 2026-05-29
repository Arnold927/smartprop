/**
 * client/src/pages/utility-bill-sender-page.tsx
 *
 * Full page wrapper for the UtilityBillSender component.
 * Accessible at /utility-bill-sender
 */

import UtilityBillSender from "@/components/utility-bill-sender";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

export default function UtilityBillSenderPage() {
  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <UtilityBillSender />
    </div>
  );
}
