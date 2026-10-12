import { readFileSync } from 'node:fs';

const assetRoot = new URL('../assets/studio/', import.meta.url);
const MIME = { woff2: 'font/woff2', webp: 'image/webp', svg: 'image/svg+xml' };

function assetDataUrl(file) {
  if (!/^(?:fonts\/)?[a-z0-9.-]+$/.test(file)) throw new Error(`Invalid Studio asset: ${file}`);
  const mime = MIME[file.split('.').pop()];
  if (!mime) throw new Error(`Unsupported Studio asset: ${file}`);
  return `data:${mime};base64,${readFileSync(new URL(file, assetRoot)).toString('base64')}`;
}

function inlineUrls(text) {
  return text.replace(/\/studio\/((?:fonts\/)?[a-z0-9.-]+\.(?:woff2|webp|svg))/g, (_, file) => assetDataUrl(file));
}

// A standalone editor/PNG must not depend on a website root or network fonts.
// The website export uses the same code and bytes with external asset URLs.
export function resolveStudioAssets(html, { external = false } = {}) {
  if (external) return html;
  return inlineUrls(html
    .replace(/<link rel="stylesheet" href="\/studio\/([a-z0-9.-]+\.css)">/g, (_, file) =>
      `<style data-studio-asset="${file}">${inlineUrls(readFileSync(new URL(file, assetRoot), 'utf8'))}</style>`)
    .replace(/<script src="\/studio\/([a-z0-9.-]+\.js)" defer><\/script>/g, (_, file) =>
      `<script data-studio-asset="${file}">${inlineUrls(readFileSync(new URL(file, assetRoot), 'utf8')).replaceAll('</script', '<\\/script')}</script>`));
}
