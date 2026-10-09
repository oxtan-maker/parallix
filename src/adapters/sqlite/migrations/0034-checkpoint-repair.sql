-- Incident-associated repair state is nested Mission checkpoint authority.
ALTER TABLE mission_checkpoints ADD COLUMN repair_json TEXT;
