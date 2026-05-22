import { RuntimeComponents } from "../types/runtime";

/**
 * Fallback Mojang component when the per-version manifest declares none. Pre-1.7 vanilla
 * versions and a handful of legacy snapshots fall in this bucket.
 *
 * @internal
 */
export const FALLBACK_COMPONENT: string = RuntimeComponents.JRE_LEGACY;
