import type { ReactNode } from "react";

interface FeatureCardProps {
  readonly eyebrow?: string;
  readonly title: string;
  readonly body: string;
  readonly ctaHref?: string;
  readonly ctaLabel?: string;
  readonly media: ReactNode;
  readonly mediaSide?: "left" | "right";
}

export function FeatureCard({
  eyebrow,
  title,
  body,
  ctaHref,
  ctaLabel,
  media,
  mediaSide = "right",
}: FeatureCardProps): React.ReactElement {
  const mediaCol = mediaSide === "right" ? "lg:col-start-13 lg:col-end-25" : "lg:col-start-1 lg:col-end-13";
  const textCol = mediaSide === "right" ? "lg:col-start-1 lg:col-end-11" : "lg:col-start-15 lg:col-end-25";
  return (
    <section className="container mb-12 lg:mb-20">
      <div className="grid grid-cols-1 lg:grid-cols-24 gap-6 lg:gap-8 rounded-2xl bg-bg-card border border-border p-6 lg:p-10">
        <div className={`flex flex-col justify-center ${textCol}`}>
          {eyebrow ? <div className="mono-cap text-text-sec mb-3">{eyebrow}</div> : null}
          <h3 className="text-h3 text-text mb-3 text-balance">{title}</h3>
          <p className="text-body text-text-sec max-w-prose">{body}</p>
          {ctaHref && ctaLabel ? (
            <a href={ctaHref} className="mt-6 inline-flex items-center text-sage-deep hover:text-text transition-colors text-[14px]">
              {ctaLabel} <span className="ml-1">→</span>
            </a>
          ) : null}
        </div>
        <div className={`min-h-[360px] rounded-xl overflow-hidden ${mediaCol}`}>{media}</div>
      </div>
    </section>
  );
}
