// Accept fixture: the repository's own src/adapters/sqlite/ adapter path is
// permitted by the application boundary guard. The forbidden token is
// 'node:sqlite' (the exact Node.js built-in specifier), not the bare substring
// 'sqlite' which would falsely reject this adapter import.
// References the real adapter file; the boundary guard test passes APPLICATION_DIR
// as scope so the transitive walk does not follow into the adapter (outside scope).
import '../../../src/adapters/sqlite/database-adapter.js';
export const acceptSqliteAdapter = true;
