interface ChangelogEntryProps {
  date: string;
  title: string;
  items: ReadonlyArray<string>;
}

function formatDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ChangelogEntry({ date, title, items }: ChangelogEntryProps) {
  return (
    <article className="grid gap-6 sm:grid-cols-[180px_1fr] py-12 border-b border-white/10 last:border-b-0">
      <div>
        <time
          dateTime={date}
          className="font-mono text-xs uppercase tracking-[0.2em] text-muted"
        >
          {formatDate(date)}
        </time>
      </div>
      <div>
        <h2 className="font-display text-2xl sm:text-3xl tracking-tight text-balance">
          {title}
        </h2>
        <ul className="mt-5 flex flex-col gap-2 text-paper/90 leading-relaxed">
          {items.map((item) => (
            <li key={item} className="flex gap-3">
              <span className="text-accent" aria-hidden>
                —
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
