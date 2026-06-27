/**
 * Mistral (Vibe) Telemetry Stub
 *
 * Mistral Vibe in programmatic mode does not output token-usage data to
 * stdout/stderr, and has no CLI endpoint for querying session usage.
 * This stub records honest zeros for all token columns so the stats CSV
 * never contains fabricated data.
 *
 * Provider and model fields are set to "mistral" to indicate the agent family.
 * The actual model is determined at runtime via VIBE_ACTIVE_MODEL env var
 * but is not captured per-session, so model falls back to "mistral".
 *
 * See task-1285 for the full telemetry credibility design. The blocked
 * verification is tracked as follow-up task-1288 ("Verify vibe/mistral
 * telemetry once usage-unblocked"), which names the missing evidence and the
 * reason it could not be collected in the task-1285 environment.
 */

/**
 * Attempt to extract telemetry from a mistral launcher result.
 * Since mistral/vibe provides no parseable usage data, always returns null.
 *
 * @param {object} result - The launcher result object
 * @returns {null} Always null — mistral/vibe has no telemetry parser
 */
function extractMistralTelemetry() {
  // Mistral Vibe does not emit token usage data. Honest zero.
  return null;
}

/**
 * Return the provider/model pair for mistral tasks.
 * Used as fallback when telemetry is null.
 *
 * @returns {{provider: string, model: string}}
 */
function getMistralProviderModel() {
  return { provider: 'mistral', model: 'mistral' };
}

module.exports = {
  extractMistralTelemetry,
  getMistralProviderModel,
};
