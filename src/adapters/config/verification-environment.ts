/** Verification commands exercise isolated state; they are not workflow writers. */
export function verificationEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...inherited };
  delete env['PARALLIX_WORKFLOW_OPERATION'];
  delete env['PARALLIX_WORKFLOW_GENERATION'];
  return env;
}
