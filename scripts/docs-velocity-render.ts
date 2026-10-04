import fs from 'node:fs';
import path from 'node:path';
import { renderVelocitySvg } from '../src/application/docs/velocity.js';
const root = process.cwd(), target = path.join(root, 'docs/assets/velocity-throughput.svg');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'docs/metrics/velocity/weekly.json'), 'utf8'));
const evidencePath = snapshot?.manualBaseline?.source?.path;
if (typeof evidencePath !== 'string' || !fs.existsSync(path.join(root, evidencePath))) { throw new Error('Velocity rendering requires retained baseline evidence in this checkout.'); }
const svg = renderVelocitySvg(snapshot);
if (process.argv.includes('--verify')) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== svg) throw new Error('Velocity SVG differs; run npm run docs:velocity:render.'); }
else fs.writeFileSync(target, svg);
