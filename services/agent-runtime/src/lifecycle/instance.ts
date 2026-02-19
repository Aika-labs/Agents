import { InProcessLifecycleManager } from "./manager.js";

/**
 * Shared singleton lifecycle manager instance.
 *
 * Extracted into its own module to avoid circular imports between
 * `app.ts` (which mounts routes) and `routes/agents.ts` (which
 * needs the lifecycle manager).
 */
export const lifecycle = new InProcessLifecycleManager();
