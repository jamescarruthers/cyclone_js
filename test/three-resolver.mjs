// Module-resolution hook: maps the bare specifier 'three' to the local
// stub so browser modules under src/ can be imported by node:test.
// Registered via node:module register() in tests that need src/ modules.

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { shortCircuit: true, url: new URL('./three-stub.mjs', import.meta.url).href };
  }
  return nextResolve(specifier, context);
}
