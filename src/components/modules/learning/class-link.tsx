import Link from "next/link";
import { getTranslations } from "next-intl/server";
export async function ClassLearningLink({ classId }: { classId: string }) {
  const t = await getTranslations("learning");
  return (
    <Link
      className="mb-4 block rounded-xl border border-primary/30 bg-primary/5 p-4 font-medium hover:bg-primary/10"
      href={`/learning?class=${classId}`}
    >
      {t("title")}
    </Link>
  );
}
