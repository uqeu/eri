"use client";

import { Component, type ReactNode } from "react";

interface CanvasBoundaryProps {
  readonly children: ReactNode;
  // Rendered if a child throws while mounting/rendering (e.g. a WebGL context
  // that fails to create even though the feature-detect passed, or a lost
  // context). Defaults to `null` so the page never crashes.
  readonly fallback?: ReactNode;
}

interface CanvasBoundaryState {
  readonly hasError: boolean;
}

// Catches render-time errors from a <Canvas> subtree (three.js throws
// "Error creating WebGL context." synchronously when a context can't be made)
// so the Next.js error overlay never appears and the rest of the page survives.
export class CanvasBoundary extends Component<
  CanvasBoundaryProps,
  CanvasBoundaryState
> {
  state: CanvasBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CanvasBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Swallowed on purpose — the fallback already stands in for the visual,
    // and a missing GPU is an expected runtime condition, not a bug to surface.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
