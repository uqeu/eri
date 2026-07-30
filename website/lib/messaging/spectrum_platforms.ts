/**
 * Platform-key normalization for the Spectrum (Photon) provider registry.
 *
 * spectrum-ts 5.2.0 keys its internal registry by the provider DEFINITION name
 * (`"iMessage"`) but routes an inbound webhook by the platform id carried in the
 * delivery envelope (`"imessage"`) — a raw `platformStates.get(platform)` with
 * no normalization, unlike every other platform lookup in the SDK. The miss
 * makes `app.webhook()` log
 *
 *   spectrum.webhook: no provider configured for platform "imessage";
 *   acknowledging without delivery
 *
 * and return **200 without ever calling the handler** — every inbound message
 * ACKed and dropped. That is what took eri silent.
 *
 * This module owns the one-line repair. It is deliberately free of SDK and
 * runtime imports so it stays directly unit-testable; `spectrum.ts` wires it to
 * the real app and does the logging.
 */

/** One alias that was added to the registry. */
export interface PlatformAlias {
  from: string;
  to: string;
}

/** The wire form of a platform id: lowercased, separators folded to `-`.
 *  Mirrors the SDK's own `normalizePlatformKey`, which it applies to every
 *  platform lookup EXCEPT the inbound-webhook one. */
export function wirePlatformKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Register every provider under its wire platform id as well as its definition
 * name, so the webhook's raw lookup resolves.
 *
 * This mutates the SDK's own registry by design — pointing a second key at the
 * SAME runtime state is what restores routing, with zero change to how the SDK
 * builds the space/message. Every consumer keys its internal maps off
 * `definition.name`, not off this map's key, so the extra entry is inert.
 *
 * Idempotent (safe to call per-request) and total: an unexpected shape returns
 * `null` rather than throwing, so an SDK change degrades to today's behavior
 * instead of 500-ing the webhook. An existing wire entry is never overwritten.
 *
 * Returns the aliases added, or `null` if `platforms` wasn't a registry.
 * Delete when we move off 5.2.0 (upstream is at 12.x).
 */
export function aliasWirePlatformKeys(platforms: unknown): PlatformAlias[] | null {
  if (!(platforms instanceof Map)) return null;

  const added: PlatformAlias[] = [];
  for (const key of Array.from(platforms.keys())) {
    if (typeof key !== "string") continue;
    const wire = wirePlatformKey(key);
    if (wire === key || platforms.has(wire)) continue;
    platforms.set(wire, platforms.get(key));
    added.push({ from: key, to: wire });
  }
  return added;
}

/** Pull the SDK's provider registry off an app instance. `__internal` is the
 *  SDK's own escape hatch (`{ platforms: platformStates }`); typed loosely so a
 *  shape change surfaces as `undefined`, not a crash. */
export function readPlatformRegistry(app: unknown): unknown {
  return (app as { __internal?: { platforms?: unknown } } | null | undefined)?.__internal?.platforms;
}
