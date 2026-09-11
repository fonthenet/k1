import Link from "next/link";
import { getTranslations } from "next-intl/server";
export async function ParentLearningLink() {
  const t = await getTranslations("learning");
  return (
    <Link
      className="my-4 block rounded-xl border bg-card p-4 font-medium text-primary"
      href="/portal/learning"
    >
      {t("parentTitle")}
    </Link>
  );
}
