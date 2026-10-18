// Inputs shared by real diagnostic checks and isolated shell-stage contracts.
export const invalidAnalysis = [
    { name: 'explicit any', file: 'src/fixture.ts', source: 'export const invalidValue: any = 1;', diagnostic: /no-explicit-any/ },
    { name: 'unsafe assignment', file: 'src/fixture.ts', source: 'export const invalidValue = JSON.parse("1");', diagnostic: /no-unsafe-assignment/ },
    { name: 'floating promise', file: 'src/fixture.ts', source: 'Promise.resolve(1);', diagnostic: /no-floating-promises/ },
    { name: 'misused promise', file: 'src/fixture.ts', source: '[1].forEach(async () => {});', diagnostic: /no-misused-promises/ },
    { name: 'complexity limit', file: 'src/fixture.ts', source: `export function complex(value: number) { ${Array.from({ length: 16 }, (_, i) => `if (value === ${i}) { return ${i}; }`).join(' ')} return value; }`, diagnostic: /complexity/ },
    { name: 'function length', file: 'src/fixture.ts', source: `export function longFunction() {\nlet value = 0;\n${'value += 1;\n'.repeat(100)}return value;\n}`, diagnostic: /max-lines-per-function/ },
    { name: 'inline lint exception', file: 'src/fixture.ts', source: '/* eslint-disable @typescript-eslint/no-explicit-any */\nexport const invalidValue: any = 1;', diagnostic: /no-explicit-any/ },
    { name: 'production compiler error', file: 'src/fixture.ts', source: 'export const invalidValue: string = 1;', diagnostic: /TS2322/ },
    { name: 'script compiler error', file: 'scripts/fixture.ts', source: 'export const invalidValue: string = 1;', diagnostic: /TS2322/ },
    { name: 'test compiler error', file: 'test/unit/analysis-contract.test.ts', source: 'export const invalidValue: string = 1;', diagnostic: /TS2322/ },
    { name: 'focused test', file: 'test/unit/analysis-contract.test.ts', source: ['test', 'only'].join('.') + '("focused", () => {});', diagnostic: /test-hygiene scanner found violations/ },
  ];
