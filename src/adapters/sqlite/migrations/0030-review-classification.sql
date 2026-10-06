-- Classifier provenance belongs to Review; bounded measurements own no attempt lifecycle.
ALTER TABLE mission_review_rounds ADD COLUMN classifier_source TEXT;
CREATE TABLE review_classifier_measurements (
  decision_id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL,
  samples TEXT NOT NULL CHECK(length(samples) <= 131072)
);
CREATE INDEX review_classifier_measurements_repository ON review_classifier_measurements(repository_id);
CREATE TABLE review_classifier_observations (
  decision_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL CHECK(length(payload) <= 16384)
);
