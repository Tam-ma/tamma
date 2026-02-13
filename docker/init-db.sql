-- =============================================================================
-- Tamma Database Initialization
--
-- Executed once by PostgreSQL on first container start via
-- docker-entrypoint-initdb.d. Creates schemas and extensions used by
-- the platform.
--
-- The full application schema (tables, indexes, triggers) is managed by
-- the ELSA and Tamma API services at runtime. This script only ensures
-- the prerequisite schemas and extensions are in place.
-- =============================================================================

-- Enable commonly used extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create schemas used by the platform
CREATE SCHEMA IF NOT EXISTS elsa;
CREATE SCHEMA IF NOT EXISTS tamma;

-- Grant permissions to the default application user
GRANT ALL ON SCHEMA elsa TO current_user;
GRANT ALL ON SCHEMA tamma TO current_user;
GRANT ALL ON SCHEMA public TO current_user;
