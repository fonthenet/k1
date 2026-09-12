import "server-only";
import { scoped } from "@/lib/tenant";
import { structureName } from "@/components/modules/classes/class-types";
import { learningContext } from "./data";
import { algiersToday, type Program } from "./domain";

/**
 * A class as the programmes overview needs it: the reader's name for it, its
 * own colour for the chip, the structure it sits in, and how many children
 * are enrolled — the one number a director weighs when picking a class for a
 * new programme.
 */
export interface ProgramClass {
  id: string;
  name: string;
  color: string;
  structure_id: string | null;
  /** The structure's center_type, which decides the suggested templates. */
  type: string;
  canTeach: boolean;
  enrolled: number;
}

/** One programme with everything the overview row shows, already reduced. */
export interface ProgramRow extends Program {
  /** Lessons that were held, out of every lesson that is not cancelled. */
  lessonsDone: number;
  lessonsTotal: number;
  /** The next lesson still ahead of us, or null when none is planned. */
  nextLessonAt: string | null;
  assessments: number;
}

/**
 * Every programme the reader may look at, plus the classes and structures
 * needed to group them, filter them and open the "new programme" dialog.
 *
 * The rail narrows what is READ — a director looking through the école sees
 * only the école's programmes and classes — and never what can be done, so
 * the dialog gets the same scoped classes: creating a crèche programme while
 * reading the école is done by widening the rail, as everywhere else.
 */
export async function programsOverview() {
  const { ctx, db, locale, classes } = await learningContext();
  const ids = classes.map((c) => c.id);
  const structures = ctx.structures
    .filter((s) => !ctx.structureId || s.id === ctx.structureId)
    .map((s) => ({
      id: s.id,
      name: structureName(s, locale),
      name_ar: s.name_ar,
      color: s.color,
      center_type: s.center_type,
    }));
  if (!ids.length)
    return {
      ctx,
      locale,
      structures,
      classes: [] as ProgramClass[],
      programs: [] as ProgramRow[],
      assessmentCount: 0,
    };
  const [classRead, programRead, lessonRead, assessmentRead, childRead] =
    await Promise.all([
      scoped(
        db
          .from("kg_classes")
          .select("id,color,structure_id")
          .eq("tenant_id", ctx.tenant.id),
        ctx,
      ),
      db
        .from("kg_learning_programs")
        .select("*")
        .eq("tenant_id", ctx.tenant.id)
        .in("class_id", ids)
        .order("starts_on", { ascending: false }),
      // Only the lessons of a programme feed the programme stats: since 0153
      // a routine block or a group activity may stand alone, and a class's
      // "Accueil" must never make a phantom "0 / 12" for a programme it is
      // not part of.
      db
        .from("kg_learning_lessons")
        .select("program_id,status,starts_at")
        .eq("tenant_id", ctx.tenant.id)
        .in("class_id", ids)
        .not("program_id", "is", null),
      db
        .from("kg_learning_assessments")
        .select("program_id")
        .eq("tenant_id", ctx.tenant.id)
        .in("class_id", ids),
      db
        .from("kg_children")
        .select("class_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled")
        .in("class_id", ids),
    ]);
  if (
    classRead.error ||
    programRead.error ||
    lessonRead.error ||
    assessmentRead.error ||
    childRead.error
  )
    throw new Error("Learning programmes unavailable");

  const enrolled = new Map<string, number>();
  for (const child of childRead.data ?? [])
    if (child.class_id)
      enrolled.set(child.class_id, (enrolled.get(child.class_id) ?? 0) + 1);
  const detail = new Map((classRead.data ?? []).map((c) => [c.id, c]));
  const order = new Map(structures.map((s, i) => [s.id, i]));
  const programClasses: ProgramClass[] = classes
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: detail.get(c.id)?.color ?? "#0d9488",
      structure_id: detail.get(c.id)?.structure_id ?? null,
      type: c.type,
      canTeach: c.canTeach,
      enrolled: enrolled.get(c.id) ?? 0,
    }))
    // The building's own order first, then the name the reader sees — the
    // database orders by the French name, which means nothing in Arabic.
    .sort(
      (a, b) =>
        (order.get(a.structure_id ?? "") ?? 99) -
          (order.get(b.structure_id ?? "") ?? 99) ||
        a.name.localeCompare(b.name, locale, { numeric: true }),
    );

  // Reduced in memory: a programme has a dozen lessons at most, and one pass
  // over the lessons beats one round trip per programme.
  const today = algiersToday();
  const stats = new Map<
    string,
    { done: number; total: number; next: string | null; assessments: number }
  >();
  const statOf = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      s = { done: 0, total: 0, next: null, assessments: 0 };
      stats.set(id, s);
    }
    return s;
  };
  for (const l of lessonRead.data ?? []) {
    if (l.status === "cancelled" || !l.program_id) continue;
    const s = statOf(l.program_id);
    s.total += 1;
    if (l.status === "completed") s.done += 1;
    else if (l.starts_at.slice(0, 10) >= today && (!s.next || l.starts_at < s.next))
      s.next = l.starts_at;
  }
  for (const a of assessmentRead.data ?? []) statOf(a.program_id).assessments += 1;

  const programs: ProgramRow[] = (programRead.data as Program[]).map((p) => {
    const s = stats.get(p.id);
    return {
      ...p,
      lessonsDone: s?.done ?? 0,
      lessonsTotal: s?.total ?? 0,
      nextLessonAt: s?.next ?? null,
      assessments: s?.assessments ?? 0,
    };
  });
  return {
    ctx,
    locale,
    structures,
    classes: programClasses,
    programs,
    assessmentCount: assessmentRead.data?.length ?? 0,
  };
}
