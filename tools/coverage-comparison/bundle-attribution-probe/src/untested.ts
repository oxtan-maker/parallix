import type { Stat } from 'node:fs';

type Alias = { a: number };

export function lonely(x: Alias): number {
  return x.a + 1;
}
