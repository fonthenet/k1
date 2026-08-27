import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, MessageSquare, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { AddChildWizard } from "@/components/modules/portal/add-child-wizard";

/**
 * An existing family enrolling another child.
 *
 * `kg_submit_sibling_application` refuses with `no_guardian_record` when the
 * signed-in account has no kg_guardians row in this tenant. The wizard handles
 * that refusal, but a parent should not fill in four steps to discover it — so
 * the same condition is checked here, before the form is offered at all.
 */
export default async function PortalNewChildPage() {
  const ctx = await getTenantContext();
  const t = await getTranslations("portal.addChild");
  const supabase = await createClient();

  // A family that enrolled before migration 0017 can hold more than one
  // guardian row, so this asks "is there at least one", not "is there exactly one".
  const { data: guardians } = await supabase
    .from("kg_guardians")
    .select("id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .limit(1);

  if (!guardians || guardians.length === 0) {
    return (
      <div className="grid gap-4">
        <Button asChild variant="ghost" size="sm" className="-ms-2 h-11 w-fit px-3">
          <Link href="/portal/children">
            <ArrowLeft className="size-4 rtl:rotate-180" data-icon="inline-start" />
            {t("back")}
          </Link>
        </Button>
        <EmptyState
          icon={<UserRoundX />}
          title={t("noGuardian.title")}
          description={t("noGuardian.description")}
          action={
            <Button asChild size="lg" className="h-11">
              <Link href="/portal/messages">
                <MessageSquare className="size-4" data-icon="inline-start" />
                {t("noGuardian.action")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <AddChildWizard userId={ctx.user.id} tenantName={ctx.tenant.name} />;
}
