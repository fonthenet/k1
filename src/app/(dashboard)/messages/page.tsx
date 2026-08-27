import { getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { Card } from "@/components/ui/card";
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
          action={<NewThreadDialog childrenOptions={childrenOptions} />}
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <ThreadsList items={items} />
          <Card className="hidden min-h-[420px] items-center justify-center border border-border py-0 shadow-sm ring-0 lg:flex">
            <div className="flex flex-col items-center gap-3 p-8 text-center text-muted-foreground">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MessagesSquare className="size-7" />
              </span>
              <p className="text-base font-semibold text-foreground">{t("messages.selectThread")}</p>
              <p className="max-w-xs text-sm leading-relaxed">{t("messages.selectThreadHint")}</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
