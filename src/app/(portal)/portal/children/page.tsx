import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { ageFromDob, childDisplayName, initials } from "@/lib/format";
import {
  classLabel,
  getMyChildren,
  getMyGuardianBadge,
  toCheckinDialogChildren,
} from "@/components/modules/portal/data";
import {
  getMyOpenApplications,
  PendingApplications,
} from "@/components/modules/portal/add-child-pending";
import { CheckinDialog } from "@/components/modules/portal/checkin-dialog";

export default async function PortalChildrenPage() {
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const tAdd = await getTranslations("portal.addChild");
  const locale = await getLocale();
  const supabase = await createClient();

  // The enrolled children and the requests still waiting on the office — a
  // family that has just applied for a sibling must see both on one screen.
  // The door badge is per guardian, so it is fetched once here and shared by
  // every card below rather than re-queried per child.
  const [children, applications, badge] = await Promise.all([
    getMyChildren(supabase, ctx),
    getMyOpenApplications(supabase, ctx),
    getMyGuardianBadge(supabase, ctx, locale),
  ]);
  const photoUrls = await Promise.all(children.map((c) => signedMediaUrl(c.photo_path)));
  // One list for every card's badge: the code is the guardian's, so the dialog
  // opened from any card can switch between all of them. Assembled from what
  // this page already loaded — no card queries anything of its own. Today's
  // attendance is not loaded here, so the tabs carry faces and names only.
  const checkinChildren = toCheckinDialogChildren(
    children,
    locale,
    new Map(children.map((c, i) => [c.id, photoUrls[i]]))
  );
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <div className="grid gap-4">
      <h2 className="text-2xl font-bold tracking-tight">{t("children.title")}</h2>

      {/* "Nobody is linked to your account" is only true when there is also no
          request in flight — a family whose first request is still being
          reviewed is not unlinked, it is waiting. */}
      {children.length === 0 && applications.length === 0 && (
        <EmptyState
          icon={<Baby />}
          title={t("home.emptyChildren")}
          description={t("home.emptyChildrenDescription")}
        />
      )}

      {children.length > 0 && (
        <div className="grid gap-3">
          {children.map((child, i) => {
            const name = childDisplayName(child, locale);
            const secondaryName =
              locale === "ar"
                ? `${child.first_name} ${child.last_name}`
                : child.first_name_ar && child.last_name_ar
                  ? `${child.first_name_ar} ${child.last_name_ar}`
                  : null;
            const cls = classLabel(child, locale);
            return (
              // The card used to BE the link. It cannot stay one: the door-badge
              // action below is an interactive control of its own, and neither
              // an anchor nor a button may nest inside another anchor. So the
              // link moved inward to the card body — face, name, age, class and
              // chevron are still one tap, and the footer carries the second,
              // separate action.
              <Card key={child.id} className="shadow-sm transition-shadow hover:shadow-md">
                <CardContent>
                  <Link
                    href={`/portal/children/${child.id}`}
                    className="-m-1 flex items-center gap-3.5 rounded-xl p-1 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Avatar className="size-12 ring-1 ring-primary/15">
                      {photoUrls[i] && <AvatarImage src={photoUrls[i]!} alt={name} />}
                      <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                        {initials(child.first_name, child.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{name}</span>
                        {secondaryName && (
                          <span className="text-sm text-muted-foreground" dir="auto">
                            {secondaryName}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{ageFromDob(child.dob, locale)}</span>
                        {/* Only ever shown when the answer is not "enrolled".
                            A badge reading "enrolled" on every card is noise;
                            a child who has been withdrawn, or is still on the
                            waiting list, is the whole point of showing it —
                            withdrawal silently kills the badge at the door. */}
                        {child.status !== "enrolled" && (
                          <Badge
                            variant={child.status === "withdrawn" ? "destructive" : "secondary"}
                            className="text-[0.6875rem]"
                          >
                            {t(`children.status.${child.status}`)}
                          </Badge>
                        )}
                        {cls && (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: child.kg_classes?.color ?? "var(--gold)" }}
                              aria-hidden
                            />
                            {cls}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <ForwardIcon className="size-4" />
                    </span>
                  </Link>
                </CardContent>
                {/* The badge is issued per guardian, not per child, so every
                    card raises the same QR — the child only decides whose name
                    is printed under it, and with siblings the dialog lets the
                    parent move between them without closing. It is here because
                    a parent at the gate reaches for the child, not for a menu,
                    and it opens in place so they never lose this list
                    mid-queue. */}
                <CardFooter className="p-0">
                  <CheckinDialog
                    badge={badge}
                    child={checkinChildren[i]}
                    family={checkinChildren}
                    trigger="block"
                    className="rounded-none"
                  />
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <PendingApplications rows={applications} />

      {/* Secondary on purpose: the children are what this page is about, and
          enrolling another one is something a family does once every few years. */}
      <Button
        asChild
        variant="outline"
        size="lg"
        className="mt-1 h-12 w-full border-dashed text-base"
      >
        <Link href="/portal/children/new">
          <Plus className="size-4" data-icon="inline-start" />
          {tAdd("trigger")}
        </Link>
      </Button>
    </div>
  );
}
