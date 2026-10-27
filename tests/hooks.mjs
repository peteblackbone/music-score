// Node loader hooks: treat project .js files as ES modules (the project has no package.json).
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.js') && !url.includes('/node_modules/')) {
    return nextLoad(url, { ...context, format: 'module' });
  }
  return nextLoad(url, context);
}
