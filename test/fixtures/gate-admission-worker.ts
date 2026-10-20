import { runPhaseGates } from '../../src/adapters/config/repository-gates.js';
import { createGateAdmission } from '../../src/composition/gate-admission.js';
import { resolveConfiguration } from '../../src/composition/config.js';
const [root, home, command] = process.argv.slice(2);
const configuration = resolveConfiguration({ ...process.env, PARALLIX_CUSTOM_ADMISSION_HOME: home });
process.stdout.write('ready\n');
const result = await runPhaseGates('integration', { configuration, admission: createGateAdmission(configuration),
  slug: 'fixture', checkoutPath: root, gates: [{ key: 'fixture', command, order: 0 }], log: () => {}, error: () => {},
});
process.exitCode = result.ok ? 0 : 1;
