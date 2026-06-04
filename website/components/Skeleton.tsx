// Anti-slop loading state: a pulsing placeholder that matches the shape of the
// content it replaces, instead of a bare "Loading…" string. Dark-only, on the
// eri surface tokens.

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-md bg-white/[0.06] ${className}`}
      aria-hidden="true"
    />
  );
}

/** A few stacked row skeletons, for lists (devices, events, tables). */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}
