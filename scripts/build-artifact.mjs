// Builds the app and inlines JS + CSS into one self-contained HTML body (for hosting as a single page,
// e.g. a claude.ai Artifact). Output: dist-artifact/fund-simulator.html
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

execSync('npx vite build', { stdio: 'inherit' });
const assets = join('dist', 'assets');
const files = readdirSync(assets);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const html = `<title>Bright Pixel Fund Simulator</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script type="module">${safeJs}</script>
`;
mkdirSync('dist-artifact', { recursive: true });
writeFileSync(join('dist-artifact', 'fund-simulator.html'), html);
console.log(`dist-artifact/fund-simulator.html  ${(html.length / 1024).toFixed(0)} KB`);
