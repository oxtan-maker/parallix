-- 0015-current-work-latest-per-mission
-- Serves SqliteOperationalHistoryRepository.findLatestByTypePerMission(), the
-- board's bounded `mission.current-work` read.
CREATE INDEX IF NOT EXISTS idx_operational_history_current_work_mission_id
  ON operational_history(event_type, json_extract(event_data, '$.missionId'), id DESC);
