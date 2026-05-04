-- Binderly local Postgres init.
--
-- Runs once, the first time the data volume is created (Postgres
-- /docker-entrypoint-initdb.d/ convention). `docker compose down -v`
-- wipes the volume and re-runs this on the next `up`.
--
-- Schema, RLS, seeds, and migrations are NOT in scope here — those are
-- owned by T-FN-DB-MIGRATIONS and the data-layer tasks. This file is
-- limited to extensions every downstream migration can assume.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
