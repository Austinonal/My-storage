import { readFileSync, writeFileSync } from 'node:fs';

const t = JSON.parse(readFileSync(new URL('../../replica/design/tokens.json', import.meta.url), 'utf8'));
const rename = { text: 'fg', 'text-muted': 'muted' }; // so classes read text-fg / text-muted, not text-text-muted
const px = (v) => (typeof v === 'number' ? `${v}px` : v);

const vars = [
  ...Object.entries(t.color).map(([k, v]) => `--color-${rename[k] ?? k}: ${v};`),
  ...Object.entries(t.font).map(([k, v]) => `--font-${k}: ${v};`),
  ...Object.entries(t.type).flatMap(([k, v]) => [
    `--text-${k}: ${v.size}px;`,
    `--text-${k}--line-height: ${v.line}px;`,
    `--text-${k}--font-weight: ${v.weight};`,
  ]),
  ...Object.entries(t.radius).map(([k, v]) => `--radius-${k}: ${px(v)};`),
  ...Object.entries(t.shadow).map(([k, v]) => `--shadow-${k}: ${v};`),
  ...Object.entries(t.motion).map(([k, v]) => `--motion-${k}: ${v};`),
  ...Object.entries(t.layout).map(([k, v]) => `--size-${k}: ${px(v)};`),
];

writeFileSync(
  new URL('../src/tokens.css', import.meta.url),
  `/* Generated from replica/design/tokens.json by scripts/tokens.mjs. Do not edit. */\n@theme static {\n${vars.map((v) => `  ${v}`).join('\n')}\n}\n`,
);
