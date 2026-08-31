export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  /** Usually a sentence, but a node so a header can name a RECORD and link to
   *  it — an invoice's subtitle is the child it bills, and that is a door. */
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-stretch gap-3">
        {/* Brand rule — the one mark every page in the app shares. */}
        <span
          aria-hidden
          className="w-1 shrink-0 rounded-full bg-gradient-to-b from-brand-from via-brand-via to-brand-to"
        />
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h2>
          {description && (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
