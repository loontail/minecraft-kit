import type { MetadataCache } from "../types/cache";
import type { HttpClient } from "../types/http";
import type { Logger } from "../types/logger";

/**
 * Shared context passed to every resolver.
 *
 * @internal
 */
export type ResolverContext = {
  readonly http: HttpClient;
  readonly cache: MetadataCache;
  readonly logger: Logger;
};
