import Link from "next/link";

// Honest pre-launch status. eri is in private alpha — there is no public
// `brew install` / `curl | sh` yet, so we don't pretend there is. When the
// installer ships, this becomes the real command block.
export function InstallBlock(): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] text-text-sec">
        <span className="size-1.5 rounded-full bg-accent" />
        Private alpha · macOS
      </span>
      <Link
        href="/download"
        className="font-mono text-[12px] text-text-ter underline-offset-4 transition-colors hover:text-text hover:underline"
      >
        Request an invite →
      </Link>
    </div>
  );
}
