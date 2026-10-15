# Static analysis

Run `./scripts/verify-local.sh static-analysis` before handing off code changes.
The gate uses standard ESLint and TypeScript exit statuses: lint errors,
lint warnings and compiler failures all block progress. Fix the reported issue
and run the check again.

Type-aware linting rejects explicit `any`, unsafe assignments, floating promises
and misused promises. Function length and complexity limits remain enforced as errors to catch
maintainability issues before SonarQube analysis. Inline ESLint overrides are
disabled for production and browser source; refactor the code rather than
suppressing a diagnostic. The ESLint configuration owns the
current rules and limits.

Production, browser, script and test TypeScript must compile. A narrowly scoped
negative-type assertion may document an intentional invalid-input contract in a
test; it must not conceal unfinished migration work. `npm run typecheck` checks
production, browser and script code when a narrower compiler check is useful.

Static analysis also enforces test hygiene and test layout. Focused tests and
unannotated skips cannot pass the gate. Run affected behavior checks through
`npm test` as well; a clean compiler does not establish correct behavior.
