// The real eri overlay surface — pill + glass panel, rendered from the same
// structure and CSS that ship inside Eri.app (see app/globals.css `.eov-*`,
// translated 1:1 from apps/eri-agent-manager/overlay.css). This is the product,
// not a mockup of it. Presentational: callers supply the panel body.

import { Mic, ArrowRight, Minus } from "lucide-react";

export function OverlayPill({
  listening = false,
}: {
  readonly listening?: boolean;
}): React.ReactElement {
  return (
    <div className="eov-pill">
      <span className={`eov-mark${listening ? " listening" : ""}`}>eri</span>
      <span className="eov-ask" aria-hidden>
        <span aria-hidden>✦</span>
        <span>Ask</span>
      </span>
      <span className="eov-divider" />
      <span className="eov-icon" aria-hidden>
        <Mic strokeWidth={2} />
      </span>
      <span className="eov-icon" aria-hidden>
        <Minus strokeWidth={2.4} />
      </span>
    </div>
  );
}

// The panel chrome (glass + rim + entrance). Body is supplied by the caller.
export function OverlayPanel({
  children,
  entering = true,
  style,
}: {
  readonly children: React.ReactNode;
  readonly entering?: boolean;
  readonly style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <section className={`eov-panel${entering ? " enter" : ""}`} style={style}>
      <div className="eov-body">{children}</div>
    </section>
  );
}

// The ask bar that sits at the foot of the panel (placeholder + ⌘↵ + send),
// matching the shipping overlay. Decorative on the marketing surface.
export function OverlayAskbar({
  placeholder = "Ask eri about your screen, or just talk",
  model = "Local · fast",
}: {
  readonly placeholder?: string;
  readonly model?: string;
}): React.ReactElement {
  return (
    <>
      <div className="eov-askbar">
        <span className="ph">{placeholder}</span>
        <span className="eov-kbd">
          <kbd>⌘</kbd>
          <kbd>↵</kbd>
        </span>
        <span className="eov-send" aria-hidden>
          <ArrowRight strokeWidth={2.4} />
        </span>
      </div>
      <div className="eov-foot">
        <span className="eov-tag">
          <span className="bolt">⚡</span>
          {model}
        </span>
        <span className="eov-tag">···</span>
      </div>
    </>
  );
}
