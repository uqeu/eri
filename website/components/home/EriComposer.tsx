import { Mic, Camera, SlidersHorizontal, ChevronDown, ArrowUp } from "lucide-react";

// A faithful replica of the real Eri.app composer (apps/eri-agent-manager):
// a clean white card in mono — the eri mark, the "What can I help you with
// today?" prompt, the tool row (voice, screen, settings, model), and the
// accent send circle. This is the actual product surface, not a mockup.
export function EriComposer(): React.ReactElement {
  return (
    <div className="eric" role="img" aria-label="The eri app: ask it anything">
      <span className="eric-mark">eri</span>
      <span className="eric-ph">What can I help you with today?</span>
      <div className="eric-tools">
        <button type="button" className="eric-icon" aria-label="Voice" tabIndex={-1}><Mic strokeWidth={1.6} /></button>
        <button type="button" className="eric-icon" aria-label="See my screen" tabIndex={-1}><Camera strokeWidth={1.6} /></button>
        <button type="button" className="eric-icon eric-icon--on" aria-label="Settings" tabIndex={-1}><SlidersHorizontal strokeWidth={1.8} /></button>
        <button type="button" className="eric-icon" aria-label="Model" tabIndex={-1}><ChevronDown strokeWidth={1.8} /></button>
        <button type="button" className="eric-send" aria-label="Build" tabIndex={-1}><ArrowUp strokeWidth={2.2} /></button>
      </div>
    </div>
  );
}
