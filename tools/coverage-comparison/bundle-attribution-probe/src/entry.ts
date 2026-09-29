import { used, neverCalled } from './mod.ts';

console.log(used(1));
if (process.argv.includes('--never')) {
  void neverCalled({ kind: 'x' });
}
