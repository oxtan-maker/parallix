/**
 * The operator-board palette and type scale, transcribed from the design
 * authority (`Parallix Board GPU.dc.html` in the reference acceptance
 * artifact). Values are literal so the rendered board matches the reference.
 */
export const C = {
  page: 'radial-gradient(120% 80% at 50% 0%,#12151a 0%,#08090b 70%)',
  panel: '#0b0e11',
  card: '#101419',
  cardHead: 'linear-gradient(180deg,#1b2027 0%,#141920 100%)',
  cardFoot: '#0d1115',
  idleCard: 'linear-gradient(180deg,#141920,#101419)',
  log: '#08090b',
  rule: '#1b2128',
  cardEdge: '#232a31',
  headEdge: '#2a323a',
  pill: '#0f1216',
  text: '#c9d2d9',
  muted: '#8b97a1',
  dim: '#6b7a85',
  faint: '#3f4a53',
  green: '#5ee08a',
  greenEdge: '#2c4735',
  greenFill: '#15211a',
  cyan: '#6fd0e8',
  amber: '#e8b84b',
  red: '#e2604e',
  purple: '#c489e0',
} as const;

/** The reference's root type treatment: mono body, condensed display heads. */
export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
export const DISPLAY = "'Barlow Condensed', 'Arial Narrow', ui-sans-serif, system-ui, sans-serif";
