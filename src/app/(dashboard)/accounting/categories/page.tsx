import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Pencil, Plus, Tags, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import type { TxnKind } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ENTITY_LINK_INHERIT_CLASS } from "@/components/shared/entity-link";
import { cn } from "@/lib/utils";
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import {
  CategoryDeleteButton,
  CategoryDialog,
} from "@/components/modules/accounting/category-dialog";
import type { CategoryOption } from "@/components/modules/accounting/types";
import { EmptyIcon, IconTile, TONE_PILL } from "@/components/modules/billing/finance-ui";

export default async function CategoriesPage() {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const t = await getTranslations("accounting");
  const tc = await getTranslations("common");
  const tid = ctx.tenant.id;

  const [catRes, txnRes] = await Promise.all([
    supabase
      .from("kg_txn_categories")
      .select("id, name, kind, color, is_system")
      .eq("tenant_id", tid)
      .order("name"),
    supabase.from("kg_transactions").select("category_id").eq("tenant_id", tid),
  ]);

  const hasError = Boolean(catRes.error || txnRes.error);
  const categories = (catRes.data ?? []) as CategoryOption[];
  const countByCat = new Map<string, number>();
  for (const tx of txnRes.data ?? []) {
    if (!tx.category_id) continue;
    countByCat.set(tx.category_id, (countByCat.get(tx.category_id) ?? 0) + 1);
  }

  const kinds: TxnKind[] = ["income", "expense"];

  return (
    <div className="space-y-6">
      <PageHeader title={t("categories.title")} description={t("categories.subtitle")} />

      <AccountingNav />

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {kinds.map((kind) => {
          const list = categories.filter((c) => c.kind === kind);
          const tone = kind === "income" ? "income" : "expense";
          return (
            <Card key={kind} className="shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <IconTile tone={tone} size="sm">
                    {kind === "income" ? <TrendingUp /> : <TrendingDown />}
                  </IconTile>
                  <div>
                    <CardTitle className="text-base font-semibold">
                      {t(`categories.${kind}`)}
                    </CardTitle>
                    <CardDescription>{t("categories.systemHint")}</CardDescription>
                  </div>
                </div>
                <CardAction>
                  <CategoryDialog
                    kind={kind}
                    trigger={
                      <Button variant="outline" size="sm">
                        <Plus data-icon="inline-start" />
                        {t("categories.add")}
                      </Button>
                    }
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                {list.length === 0 ? (
                  <EmptyState
                    icon={
                      <EmptyIcon tone="muted">
                        <Tags />
                      </EmptyIcon>
                    }
                    title={t("categories.empty")}
                  />
                ) : (
                  <ul className="divide-y">
                    {list.map((cat) => (
                      <li
                        key={cat.id}
                        className="flex items-center gap-3 rounded-lg py-2 ps-2 transition-colors hover:bg-muted/50"
                      >
                        <span
                          className="size-3 shrink-0 rounded-full ring-2 ring-card"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {cat.name}
                        </span>
                        {cat.is_system && (
                          <Badge className={TONE_PILL.muted}>{t("categories.system")}</Badge>
                        )}
                        {/* The count is the question — "what ARE those twelve
                            salary payments?" — and it had no answer. month=all
                            because this count is all-time; the ledger's default
                            current-month view would show 11 of the 12 it
                            promises, which is worse than not linking at all.
                            A category with nothing in it stays plain text
                            rather than offering an empty list. */}
                        {(countByCat.get(cat.id) ?? 0) > 0 ? (
                          <Link
                            href={`/accounting/transactions?category=${cat.id}&month=all`}
                            className={cn(ENTITY_LINK_INHERIT_CLASS, "text-xs tabular-nums text-muted-foreground")}
                          >
                            {t("txn.count", { count: countByCat.get(cat.id) ?? 0 })}
                          </Link>
                        ) : (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {t("txn.count", { count: 0 })}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <CategoryDialog
                            kind={kind}
                            category={cat}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={tc("actions.edit")}
                              >
                                <Pencil />
                              </Button>
                            }
                          />
                          {!cat.is_system && <CategoryDeleteButton category={cat} />}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
