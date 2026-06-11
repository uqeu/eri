import type { ReactNode } from "react";
import { EriTerminal, type Kind } from "./EriTerminal";

export interface CapabilityRowProps {
  readonly title: string;
  readonly body: string;
  readonly icon: ReactNode;
  readonly focus: Kind;
  /** Place the pad on the left (copy on the right) for alternating rhythm. */
  readonly flip?: boolean;
}

/**
 * One capability, full-width: copy on one side, the live glass pad locked to
 * that capability's scene on the other. Rows alternate sides down the page.
 */
export function CapabilityRow({
  title,
  body,
  icon,
  focus,
  flip = false,
}: CapabilityRowProps): React.ReactElement {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={flip ? "lg:order-2" : ""}>
        <span
          className="flex h-11 w-11 items-center justify-center rounded-[11px] border border-border bg-white/[0.03] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          aria-hidden
        >
          {icon}
        </span>
        <h3
          className="mt-6 font-display text-[28px] leading-[1.12] tracking-[-0.02em] text-text sm:text-[34px]"
          style={{ fontWeight: 500 }}
        >
          {title}
        </h3>
        <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-text-sec">
          {body}
        </p>
      </div>
      <div className={flip ? "lg:order-1" : ""}>
        <EriTerminal focus={focus} className="relative mx-auto w-full max-w-[520px]" />
      </div>
    </div>
  );
}
