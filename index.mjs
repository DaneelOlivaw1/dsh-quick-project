/**
 * Main Host half of dsh-quick-project.
 *
 * Deliberately empty of behaviour. Everything the plugin does on the Host is one
 * HTTP endpoint that lives in `host/name-route.mjs`, mounted as its own profile
 * patch entry: Node caches an ESM module by URL for the life of the process, so
 * a route defined here could only ever appear after a Host restart, while a
 * module the process has never imported is picked up on recompose.
 *
 * The browser half is the plugin; this file only names it.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'quick-project'

/** No Host services are read here. */
export const inject = []

/** Nothing to wire on the Host. */
export function apply() {}
