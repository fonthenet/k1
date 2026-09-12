import Link from "next/link";
import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import type { TxnKind } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { CategoryDialog } from "@/components/modules/accounting/category-dialog";
import type { CategoryOption } from "@/components/modules/accounting/types";

export default async function CategoriesPage() {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const t = await getTranslations("accounting");
  const tc = await getTranslations("common");
  const tid = ctx.tenant.id;

  const [catRes, countRes] = await Promise.all([
    supabase
      .from("kg_txn_categories")
      .select("id, name, kind, color, is_system")
      .eq("tenant_id", tid)
      .order("name"),
    // Counted in Postgres (0106): one row per category, never one per
    // transaction. Reading every category_id to count them here stopped being
    // exact at PostgREST's 1 000-row cap — and "12 transactions" that opens a
    // list of 14 is the very mismatch the month=all link below exists to avoid.
    supabase.rpc("kg_category_txn_counts", { p_tenant: tid }),
  ]);

  const hasError = Boolean(catRes.error || countRes.error);
  const categories = (catRes.data ?? []) as CategoryOption[];
  const countByCat = new Map(
    ((countRes.data ?? []) as { category_id: string; n: number | string }[]).map((r) => [
      r.category_id,
      Number(r.n),
    ])
  );

  const kinds: TxnKind[] = ["income", "expense"];

  return (
    <div className="space-y-6">
      {/* One primary per page: the dialog asks which kind on its first row,
          so the two per-card add buttons are gone. */}
      <PageHeader title={t("categories.title")} description={t("categories.subtitle")}>
        <CategoryDialog
          trigger={
            <Button>
              <Plus data-icon="inline-start" />
              {t("categories.add")}
            </Button>
          }
        />
      </PageHeader>

      <AccountingNav />

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      {/* One list, two group rows, in the register card the classes page
          uses: the page header already said "Catégories", so the card does
          not say it again. A category is a category, and the kind is a
          heading. A system category is told apart by what its dialog does
          not offer (no Supprimer), not by a badge on every other row. */}
      <Card className="border border-border py-0 shadow-sm ring-0">
        <CardContent className="px-0">
          <ul className="divide-y divide-border">
            {kinds.map((kind) => {
              const list = categories.filter((c) => c.kind === kind);
              return (
                <Fragment key={kind}>
                  <li className="bg-muted/30 px-5 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{t(`categories.${kind}`)}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {t("categories.count", { count: list.length })}
                      </span>
                    </span>
                  </li>
                  {list.length === 0 && (
                    <li className="px-5 py-4 text-sm text-muted-foreground">
                      {t("categories.empty")}
                    </li>
                  )}
                  {list.map((cat) => {
                    const count = countByCat.get(cat.id) ?? 0;
                    const name = (
                      <>
                        <span
                          className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                          style={{ backgroundColor: cat.color }}
                          aria-hidden
                        />
                        <bdi dir="auto" className="truncate">
                          {cat.name}
                        </bdi>
                      </>
                    );
                    return (
                      <li
                        key={cat.id}
                        className="relative flex h-12 items-center gap-3 px-5 transition-colors hover:bg-primary/5"
                      >
                        {/* The count is the question — "what ARE those twelve
                            salary payments?" — and the row answers it. month=all
                            because this count is all-time; the ledger's default
                            current-month view would show 11 of the 12 it
                            promises, which is worse than not linking at all. A
                            category with nothing in it is not a door. */}
                        {count > 0 ? (
                          <Link
                            href={`/accounting/transactions?category=${cat.id}&month=all`}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-medium after:absolute after:inset-0"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="flex min-w-0 flex-1 items-center gap-2.5 text-sm font-medium">
                            {name}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {count > 0 ? t("txn.count", { count }) : "0"}
                        </span>
                        <span className="relative z-10 flex items-center">
                          <CategoryDialog
                            category={cat}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tc("actions.edit")}
                                title={tc("actions.edit")}
                              >
                                <Pencil />
                              </Button>
                            }
                          />
                        </span>
                      </li>
                    );
                  })}
                </Fragment>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Why some rows have no Supprimer, said once under the list — the way
          the journal states where the closed ledger ends. */}
      <p className="text-sm text-muted-foreground">{t("categories.systemHint")}</p>
    </div>
  );
}
