# Mission timestamp storage and normalization

Mission lifecycle (`board_lane_events.occurred_at`) and administrative closure
(`missions.closed_at`) are persisted as **canonical UTC ISO-8601 instants**:
`YYYY-MM-DDTHH:mm:ss.sssZ` — explicit millisecond precision and an explicit
`Z`. A single fixed-width spelling keeps lexical ordering equal to temporal
ordering, so `ORDER BY occurred_at` and string compares order correctly for canonical values. During migration, readers still compare parsed instants.

## Mixed-format compatibility (read path)

During the transition readers accept **both** spellings:

* UTC `Z` instants (`Date.prototype.toISOString` output), and
* explicit-offset instants (for example `2026-10-09T09:07:00+02:00`, the shape
  `git show --format=%cI` produces for landed commits).

Every stored value is parsed to an instant before any ordering, windowing, or
reporting decision, so a mixed population never misorders.

## Local reporting is unchanged

Reporting uses the operator local timezone independently of storage precision.
The web board's missions per week and weekly DONE band use the first recorded
delivery to select the reporting week. A later administrative close or repeat
DONE event cannot move an earlier delivery into the current week. The DONE rail
and weekly DONE band select missions delivered within the same reporting week
used by missions per week. The weekly total retains a delivery
even if the mission is subsequently reopened; a reopened mission appears in
its current lane. Retained records from other weeks and records with unavailable delivery dates appear separately under
Other completed history; an administrative closure never supplies a missing
delivery date. These records remain accessible without inflating the weekly
count.
A delivery stored as an offset instant and the same delivery stored as UTC `Z`
fall in the same local window, so migration does not move membership across
midnight, DST transitions, or year boundaries. Calendar-date measurement fields
are not instants and are not normalized. Supported lifecycle sources are JavaScript
Dates (milliseconds) and Git commit timestamps (seconds). Fractions finer than
milliseconds are converted only when their extra digits are all zero; otherwise
the migration reports and preserves the original value as unsupported precision.
New or changed closure timestamps reject such values rather than truncate them.
Editing other Mission fields preserves an existing unsupported closure value
verbatim; it does not require repairing that historical timestamp first. Invalid
calendar dates and missing timezones are never accepted as new instants.

## Normalizing an existing operator database

The migration converts offset instants to canonical UTC, preserving each instant
exactly. It never assigns a timezone to a value that has none, discards data, or
rounds away an instant; naive (no-zone), invalid calendar and unsupported precision values are reported
by record and field and left untouched in both dry-run and migrate output.
A dry-run never applies schema upgrades. Conversion is transactional after a
SQLite backup succeeds.

Run it against an isolated copy first. The three modes:

* `dry-run` — classify every stored value and report what will convert; change nothing.
* `migrate` — back up the database, then convert offset instants to UTC.
* `recover` — restore the most recent `<database>.bak.<timestamp>` snapshot.

```
tsx scripts/normalize-mission-timestamps.ts --mode dry-run
tsx scripts/normalize-mission-timestamps.ts --mode migrate
tsx scripts/normalize-mission-timestamps.ts --mode recover
```

Add `--home <dir>` to target a specific Parallix home. A second `migrate` run is
a no-op: nothing left to convert means no backup is written.

### Before touching real operator data

1. Pause all Parallix writers. Take a SQLite-consistent backup (including committed
   WAL data), and keep an independent copy outside the working home.
2. Copy the database into an isolated home and run `--mode dry-run --home <copy>`.
   Review each preserved record and field. Resolve ambiguous values only with
   independent timezone evidence; retain unsupported precision for separate repair.
3. Run `--mode migrate --home <copy>`, compare local report membership and counts,
   and repeat migration to confirm no additional conversions.
4. Run `--mode recover --home <copy>` and verify the original values return.
   Recovery restores the most recent migration backup and overwrites subsequent
   writes, so keep writers stopped and preserve newer data separately if needed.
5. After accepting the audit and rehearsal, repeat dry-run and migrate against
   the real home while writers remain paused. Keep the printed backup path and
   independent snapshot until reports are verified; use recover before resuming
   writers if verification fails.
