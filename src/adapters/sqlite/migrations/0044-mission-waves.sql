-- PX-0030: persist Mission wave relationships and explicit Large-mission risk decisions.
ALTER TABLE missions ADD COLUMN wave_parent_id TEXT;
ALTER TABLE missions ADD COLUMN wave_children_json TEXT;
ALTER TABLE missions ADD COLUMN large_risk_rationale TEXT;
ALTER TABLE missions ADD COLUMN large_risk_approved_by TEXT;
ALTER TABLE missions ADD COLUMN large_risk_approved_at TEXT;
