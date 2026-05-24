import type { ReactNode } from "react";

interface FeatureCardProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly body: string;
  readonly ctaHref?: string;
  readonly ctaLabel?: string;
  readonly media: ReactNode;
}

export function FeatureCard({
  eyebrow,
  title,
  body,
  ctaHref,
  ctaLabel,
  media,
}: FeatureCardProps): React.ReactElement {
  return (
    <section className="mb-16 lg:mb-28">
      <div className="container mb-8 lg:mb-10">
        <div className="max-w-2xl">
          {eyebrow ? <div className="mono-cap text-text-sec mb-3">{eyebrow}</div> : null}
          <h3 className="text-h2 text-text mb-3 text-balance">{title}</h3>
          <p className="text-body text-text-sec max-w-prose">{body}</p>
          {ctaHref && ctaLabel ? (
            <a
              href={ctaHref}
              className="mt-5 inline-flex items-center text-text-sec hover:text-text transition-colors text-[14px]"
            >
              {ctaLabel} <span className="ml-1">→</span>
            </a>
          ) : null}
        </div>
      </div>
      <div className="w-full">{media}</div>
    </section>
  );
}
