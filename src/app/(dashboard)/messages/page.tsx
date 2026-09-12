import { getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { NewThreadDialog } from "@/components/modules/comms/new-thread-dialog";
import { ThreadsList } from "@/components/modules/comms/threads-list";
import { fetchThreadItems } from "@/components/modules/comms/queries";
import type { ChildOption } from "@/components/modules/comms/types";
import { getLocale } from "next-intl/server";

export default async function MessagesPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const supabase = await createClient();

  const [items, { data: childRows }] = await Promise.all([
    fetchThreadItems(ctx.tenant.id, ctx.user.id, locale),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
  ]);
  const childrenOptions: ChildOption[] = childRows ?? [];

  return (
    <div>
      <PageHeader title={t("messages.title")} description={t("messages.description")}>
        <NewThreadDialog childrenOptions={childrenOptions} />
      </PageHeader>

      {items.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title={t("messages.empty")}
          description={t("messages.emptyDescription")}
        />
      ) : (
        /* The list alone, at full width. The index used to split the page
           with an empty "choose a conversation" card — a box whose only
           content was that nothing had been chosen yet. The split belongs to
           /messages/[threadId], where there is a thread to show beside it. */
        <ThreadsList items={items} />
      )}
    </div>
  );
}
