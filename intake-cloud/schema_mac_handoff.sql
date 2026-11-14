-- One-click Mac handoff (CollectionsToPrice). Safe to re-run ADD COLUMN if already present fails: ignore.

ALTER TABLE collections ADD COLUMN mac_handoff_status TEXT;
ALTER TABLE collections ADD COLUMN mac_handoff_at TEXT;
ALTER TABLE collections ADD COLUMN mac_handoff_folder TEXT;
