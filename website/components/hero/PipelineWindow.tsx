"use client";

import { PromptPipeline } from "../PromptPipeline";

export function PipelineWindow(): React.ReactElement {
  return (
    <div className="h-full w-full overflow-auto bg-[#0A0A0A] p-2">
      <PromptPipeline />
    </div>
  );
}
