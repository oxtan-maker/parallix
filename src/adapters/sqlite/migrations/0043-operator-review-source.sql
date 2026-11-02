-- Human corrections are not judgments made by the configured reviewer.
ALTER TABLE mission_review_rounds ADD COLUMN operator_author TEXT
  CHECK (operator_author IS NULL OR
    (decision_kind = 'changes-requested' AND length(trim(operator_author)) > 0
      AND classifier_source IS NULL AND mechanical_source IS NULL));
