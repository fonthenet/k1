import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  AlertTriangleIcon,
  BabyIcon,
  ArrowLeftIcon,
  MapPinIcon,
  PlusIcon,
  SchoolIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { KgRole, Membership, Tenant } from "@/lib/types";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Wordmark } from "@/components/landing/wordmark";
import { LocaleToggle } from "@/app/(auth)/_components/locale-toggle";
import {
  centerTypeLabel,
  centerTypeOption,
} from "@/components/modules/settings/center-types";
import { ClaimCard } from "./_components/claim-card";
import {
  getMyPendingApplications,
  PendingApplicationsNotice,
} from "./_components/pending-applications";
import { CreateWizard } from "./_components/create-wizard";
import { OpenWorkspaceButton } from "./_components/open-workspace-button";
import { chooseWorkspace } from "./actions";
import { displayIdentity } from "@/lib/auth-identifier";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("onboarding.metaTitle") };
}

type MembershipRow = Membership & { kg_tenants: Tenant | null };

/** Tinted pill per role — gold marks the roles that own the workspace. */
const ROLE_TONE: Record<KgRole, { pill: string; dot: string }> = {
  owner: { pill: "bg-gold/15 text-foreground", dot: "bg-gold" },
  admin: { pill: "bg-gold/15 text-foreground", dot: "bg-gold" },
  educator: { pill: "bg-primary/10 text-primary", dot: "bg-primary" },
  staff: { pill: "bg-primary/10 text-primary", dot: "bg-primary" },
  accountant: { pill: "bg-primary/10 text-primary", dot: "bg-primary" },
  parent: { pill: "bg-secondary text-secondary-foreground", dot: "bg-muted-foreground" },
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string | string[]; claim?: string | string[] }>;
}) {
  const t = await getTranslations("auth");
  const sp = await searchParams;
  const forceCreate = sp.create === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // An invite link carries the code in the query string. Redirecting a
  // signed-out parent to a bare /onboarding threw the code away and left them
  // on a screen with an empty box, so the destination has to survive the trip
  // through sign-in — and through sign-up, which is where a new parent goes.
  const rawClaim = Array.isArray(sp.claim) ? sp.claim[0] : sp.claim;
  const claimCode = rawClaim ? rawClaim.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16) : "";
  if (!user) {
    const dest = claimCode ? `/onboarding?claim=${claimCode}` : "/onboarding";
    redirect(`/login?next=${encodeURIComponent(dest)}`);
  }

  const { data, error } = await supabase
    .from("kg_memberships")
    .select("*, kg_tenants(*)")
    .eq("user_id", user.id)
    .eq("status", "active");

  const memberships = ((data ?? []) as MembershipRow[]).filter((m) => m.kg_tenants);

  // A parent who has asked to enrol a child has no membership either — one only
  // appears when staff approve. Without this, "no membership" meant exactly one
  // thing, "you must be opening a nursery", and a family that had just
  // submitted a request was shown the founder wizard.
  const pending = memberships.length === 0 ? await getMyPendingApplications(user.id) : [];

  // A claim code has to be honoured whatever else this account already is.
  // Without `claimCode` here, anyone who already holds a membership — an owner
  // testing their own invite, or a parent whose second child is at another
  // crèche — landed on the workspace chooser and the code in the URL was
  // silently dropped. The chooser is still one link away (below), so nothing
  // is lost for someone who followed the link by accident.
  const showWizard = forceCreate || memberships.length === 0 || claimCode !== "";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,var(--primary),transparent_70%)] opacity-[0.09]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-24 -end-24 size-80 rounded-full bg-gold/10 blur-3xl"
        aria-hidden
      />

      <header className="relative mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Wordmark />
        <LocaleToggle />
      </header>

      <main className="relative mx-auto w-full max-w-4xl px-4 pt-8 pb-16 sm:px-6">
        {error ? (
          <Alert
            variant="destructive"
            className="mx-auto max-w-lg border-destructive/25 bg-destructive/5"
          >
            <AlertTriangleIcon />
            <AlertTitle>{t("errors.loadFailed")}</AlertTitle>
            <AlertDescription>{t("errors.generic")}</AlertDescription>
          </Alert>
        ) : showWizard ? (
          <div className="mx-auto max-w-3xl">
            {/* Order matters: a request already in flight explains the empty
                screen better than anything else, so it goes first. Then the
                claim code. The create-a-business wizard is last because it is
                the least likely reason a person with no membership is here. */}
            {/* A person with no membership is here for one of two reasons,
                and the product is sold to one of them. Creating an
                establishment is therefore the page, not a door off it.

                The previous order put the parent card and a code box first
                and hid the founder wizard behind ?create=1, because generic
                signup used to drop confused parents onto a
                CREATE-A-KINDERGARTEN form. That risk is handled here by
                keeping the parent route plainly visible underneath rather
                than by demoting the founder — and by leading the parent with
                the LINK, which is how they actually arrive. The code is a
                fallback, so it now sits behind a disclosure instead of being
                the first thing a parent is asked for. */}
            {pending.length > 0 && (
              <div className="mb-5">
                <PendingApplicationsNotice rows={pending} />
              </div>
            )}

            {memberships.length > 0 && (
              <Link
                href="/onboarding"
                className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
                {t("onboarding.backToWorkspaces")}
              </Link>
            )}

            <Card className="gap-0 overflow-hidden py-0 shadow-sm ring-border">
              <CardHeader className="border-b border-border/60 bg-shell/45 py-5">
                <div className="flex items-start gap-3.5">
                  {/* Gold: creating a kindergarten is the celebratory moment of this flow. */}
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gold text-gold-foreground shadow-sm"
                    aria-hidden
                  >
                    <SchoolIcon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="text-xl font-semibold tracking-tight">
                      {t("onboarding.createTitle")}
                    </CardTitle>
                    <CardDescription className="mt-1 text-pretty">
                      {t("onboarding.createSubtitle")}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="py-6">
                <CreateWizard />
              </CardContent>
            </Card>

            {/* Not a founder. Quiet, but never hidden — and open already if
                they followed a link that carries their code. */}
            <Card className="mt-5 border border-border shadow-sm ring-0">
              <CardContent className="flex items-start gap-3.5">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
                >
                  <BabyIcon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">
                    {t("onboarding.parentPath.title")}
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-pretty text-muted-foreground">
                    {t("onboarding.parentPath.body")}
                  </p>
                  <details className="group/claim mt-3" open={Boolean(claimCode)}>
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-sm font-medium text-primary hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
                      <ArrowLeftIcon
                        className="size-3.5 -rotate-90 transition-transform group-open/claim:rotate-0 rtl:rotate-90 rtl:group-open/claim:rotate-180"
                        aria-hidden
                      />
                      {t("onboarding.claim.toggle")}
                    </summary>
                    <div className="mt-3">
                      <ClaimCard initialCode={claimCode} />
                    </div>
                  </details>
                </div>
              </CardContent>
            </Card>

            <p className="mt-6 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                <SchoolIcon className="size-3.5 text-primary" aria-hidden />
                {t("onboarding.signedInAs", { email: displayIdentity(user.email) })}
              </span>
            </p>
          </div>
        ) : (
          <div>
            <div className="mx-auto mb-8 max-w-md text-center">
              <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
                {t("onboarding.workspacesTitle")}
              </h1>
              <span className="mx-auto mt-3 block h-1 w-12 rounded-full bg-gold" aria-hidden />
              <p className="mt-3 text-sm text-muted-foreground text-pretty">
                {t("onboarding.workspacesSubtitle")}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {memberships.map((m) => {
                const tenant = m.kg_tenants as Tenant;
                const role = m.role as KgRole;
                const tone = ROLE_TONE[role];
                const location = [tenant.commune, tenant.wilaya].filter(Boolean).join(", ");
                // center_type arrived in migration 0009; the Tenant type is lead-owned.
                const centerType = (tenant as Tenant & { center_type?: string | null })
                  .center_type;
                const { Icon: CenterIcon } = centerTypeOption(centerType);
                return (
                  <Card
                    key={m.id}
                    className="flex flex-col shadow-sm ring-border transition-all hover:shadow-md hover:ring-primary/30"
                  >
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-from to-brand-to text-sm font-bold text-white shadow-sm">
                          {initials(tenant.name, tenant.name.split(" ").at(-1) ?? "")}
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base font-semibold">
                            {tenant.name}
                          </CardTitle>
                          {location && (
                            <CardDescription className="mt-1 flex items-center gap-1.5">
                              <MapPinIcon className="size-3.5 shrink-0 text-primary" aria-hidden />
                              <span className="truncate">{location}</span>
                            </CardDescription>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("h-6 gap-1.5 border-transparent px-2.5", tone.pill)}
                      >
                        <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
                        {t(`roles.${role}`)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="h-6 gap-1.5 border-border bg-secondary px-2.5 font-normal text-secondary-foreground"
                      >
                        <CenterIcon className="size-3.5" aria-hidden />
                        {centerTypeLabel(centerType, t)}
                      </Badge>
                      {role === "parent" && (
                        <span className="text-xs text-muted-foreground">
                          {t("onboarding.parentWorkspaceHint")}
                        </span>
                      )}
                    </CardContent>
                    <CardFooter className="mt-auto">
                      <form action={chooseWorkspace.bind(null, tenant.id)} className="w-full">
                        <OpenWorkspaceButton />
                      </form>
                    </CardFooter>
                  </Card>
                );
              })}

              <Link
                href="/onboarding?create=1"
                className="group flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 p-6 text-center transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm"
              >
                <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  <PlusIcon className="size-5" aria-hidden />
                </span>
                <span className="font-semibold text-foreground">{t("onboarding.createNew")}</span>
                <span className="max-w-[28ch] text-xs text-muted-foreground text-pretty">
                  {t("onboarding.createNewHint")}
                </span>
              </Link>
            </div>

            <p className="mt-10 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                <SchoolIcon className="size-3.5 text-primary" aria-hidden />
                {t("onboarding.signedInAs", { email: displayIdentity(user.email) })}
              </span>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
