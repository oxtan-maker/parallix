import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../src/adapters/agents/agents.js';
import { fakeLifecycleAgent } from './e2e-lifecycle-fake-agent.js';

// The mocked lifecycle suite supplies a port before the CLI composition loads.
// Any attempt to resolve or probe an executable is therefore a regression.
setCommandPathProbe(() => '/in-process-fake-agent');
setLauncherHealthProbe(() => ({ ok: true }));
setWorkflowLaunchPort(fakeLifecycleAgent);
