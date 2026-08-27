-- Migration: 0017-retire-mission-import-provenance
-- Description: Remove the retired Mission compatibility import version snapshot.
-- Authority: operator-local only

DROP TABLE IF EXISTS import_mission_versions;
