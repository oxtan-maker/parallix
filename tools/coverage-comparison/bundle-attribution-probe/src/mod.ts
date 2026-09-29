import type { Stat } from 'node:fs';

export interface Shape { readonly kind: string }

export function used(value: number): number {
  if (value > 10) {
    return value * 2;
  }
  return value;
}

export async function neverCalled(shape: Shape, stat?: Stat): Promise<string> {
  const text = `${shape.kind}`;
  if (stat) {
    return text + 'stat';
  }
  return text;
}
