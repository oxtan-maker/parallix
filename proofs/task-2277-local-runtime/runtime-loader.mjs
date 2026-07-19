export async function resolve(specifier, context, nextResolve) {
  const resolution = await nextResolve(specifier, context);
  if (resolution.url.includes('/node_modules/')) {
    console.error(`NODE_MODULES_RUNTIME_LOAD ${resolution.url}`);
  }
  return resolution;
}
