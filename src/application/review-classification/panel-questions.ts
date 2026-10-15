import type { DecisionQuestion } from '../ports/decision.js';

/** Operator-frozen bodies; changes require a new policy decision. */
export const PANEL_QUESTIONS = {
  "v3": {
    "type": "choice",
    "instructions": "When the state lists omissions, that evidence was not shown. Select insufficient_evidence when an omitted change could decide the answer. Decide whether the repair resolves every prior finding and is safe across the directly affected change surface. The scope includes consequences introduced by the repair, not just the previously named failure mode. Evaluate two requirements together: (1) the requested correction is actually implemented; (2) the correction preserves consistency of affected producers, consumers, configuration and descriptions. Complete referenced files are NOT proof of a complete change surface, and a diff restricted to cited paths may hide other repair changes. For changes to user-facing meaning, classifications, quantities, precision, output formats or terminology, verify the affected consumer-facing descriptions/labels as well as the producing code. A corrected producer alone cannot establish that related descriptions remain accurate. For shared runners, verify argument/configuration composition under the supported invocation variants, not only the tested local path. Choose insufficient_evidence if these material counterparts or paths are absent; do not assume they are correct just because the original finding was narrower. Do not demand unrelated context or new runtime proof for self-contained document/test corrections. Choose does_not_address only for an evidenced unresolved obligation or evidenced related regression, never for an unproven possibility. Exclude unrelated pre-existing defects and improvements. Implementer claims and historical approvals are not authoritative proof.",
    "criteria": {
      "addresses": "Both requirements are supported: all prior findings resolved AND consistency/preservation established across materially affected paths and content. A local fix with missing material consumer/description evidence is not addresses.",
      "does_not_address": "Supplied evidence demonstrates an unresolved prior finding or a related regression from the repair.",
      "insufficient_evidence": "The local correction may work, but missing material change-surface, counterpart, supported-invocation or description evidence prevents establishing safe resolution."
    }
  },
  "v1": {
    "type": "choice",
    "instructions": "When the state lists omissions, that evidence was not shown. Select insufficient_evidence when an omitted change could decide the answer. Assess whether the candidate resolves all prior findings without introducing a related regression. Check the changed behavior and its directly affected callers, configuration, tests and documentation. A locally correct fix is incomplete if it breaks another supported use of that behavior or leaves related content inconsistent. Exclude unrelated pre-existing defects and unrelated new improvements. Do not exclude a defect merely because the previous reviewer did not mention it: regressions introduced by the repair are in scope. Treat implementer claims as claims; check them against supplied evidence. Match evidence to the obligation: document and checkpoint fixes can be established by document or record changes; executable fixes require tracing executable behavior. Do not require fresh test execution where prior findings permit carrying forward evidence. Choose insufficient_evidence for a specific material missing fact, not does_not_address. Judge the repair and its direct consequences, not unrelated whole-mission quality.",
    "criteria": {
      "addresses": "Every prior obligation is resolved, and supplied evidence supports preservation of directly affected behavior and content.",
      "does_not_address": "Evidence demonstrates an unresolved prior obligation or a related regression introduced by the repair.",
      "insufficient_evidence": "A specific missing fact prevents determining whether the prior obligations are resolved and directly affected behavior/content preserved."
    }
  },
  "original": {
    "type": "choice",
    "instructions": "When the state lists omissions, that evidence was not shown. Select insufficient_evidence when an omitted change could decide the answer. Assess whether candidate source addresses the entire specific review finding. Trace executable behavior and relevant dependencies. Comments and implementer claims are not proof. Do not approve the whole mission, demand unrelated improvements, or infer runtime tests passed. Select insufficient_evidence when omitted dependencies or ambiguous contracts prevent a reliable judgment. A repair must preserve required behavior on the repaired path: removing a symptom by preventing normal completion, suppressing required output, or introducing another failure does not resolve the finding. Treat implementer explanations as claims to check against source. If preservation cannot be established from supplied evidence, select insufficient_evidence.",
    "criteria": {
      "addresses": "The supplied executable source removes all failure modes described in the specific finding.",
      "does_not_address": "The supplied source demonstrates at least one described failure mode still exists, including an incomplete fix.",
      "insufficient_evidence": "The supplied source does not support a reliable resolution judgment."
    }
  }
} as const satisfies Record<string, DecisionQuestion>;
export type PanelQuestionId = keyof typeof PANEL_QUESTIONS;
export const PANEL_PROMPT_VERSION = 'resolution-v3-v1-original-omissions-v2';
