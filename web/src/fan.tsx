/**
 * The reference's cooling-fan glyph: a conic blade pattern that turns while
 * the server reports live work on the card and sits still otherwise. The
 * rotation is a CSS keyframe (`style.css`), so the client keeps no timer and
 * no animation state of its own.
 */
import type { CSSProperties } from 'react';

const BLADES = 9;

function bladeGradient(color: string): string {
  const step = 360 / BLADES;
  const stops: string[] = [];
  for (let i = 0; i < BLADES; i += 1) {
    const angle = i * step;
    stops.push(
      `${color}00 ${angle.toFixed(1)}deg`,
      `${color}99 ${(angle + step * 0.30).toFixed(1)}deg`,
      `${color}2e ${(angle + step * 0.60).toFixed(1)}deg`,
      `${color}00 ${(angle + step * 0.62).toFixed(1)}deg`,
    );
  }
  return `conic-gradient(from 0deg,${stops.join(',')})`;
}

export function Fan({ size, color, spinning, speed = '1.7s' }: {
  size: number;
  color: string;
  spinning: boolean;
  speed?: string;
}) {
  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    background: [
      'radial-gradient(circle at 50% 50%, #232b34 0 20%, #161c22 21%, rgba(0,0,0,0) 23%)',
      'radial-gradient(circle at 50% 28%, rgba(255,255,255,.07) 0, rgba(0,0,0,0) 62%)',
      bladeGradient(color),
    ].join(','),
    boxShadow: `inset 0 0 0 1px #2f3944, inset 0 0 5px rgba(0,0,0,.75)${spinning ? `, 0 0 7px ${color}2e` : ''}`,
    opacity: spinning ? 1 : 0.5,
    animationDuration: spinning ? speed : undefined,
  };
  return <span aria-hidden="true" className={spinning ? 'fan spin' : 'fan'} style={style} />;
}
