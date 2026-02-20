-- Tamma Database Schema
-- ELSA Workflows Mentorship Engine
-- Version: 1.0.0

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Core Entities
-- =============================================================================

-- Junior Developers Table
-- Stores information about junior developers being mentored
-- (Created before mentorship_sessions due to foreign key dependency)
CREATE TABLE IF NOT EXISTS junior_developers (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text,
    slack_id text,
    github_username text,
    skill_level integer DEFAULT 1 CHECK (skill_level >= 1 AND skill_level <= 5),
    preferences jsonb DEFAULT '{}',
    learning_patterns jsonb DEFAULT '[]',
    total_sessions integer DEFAULT 0,
    successful_sessions integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Stories Table
-- Stores story/task information for mentorship sessions
-- (Created before mentorship_sessions due to foreign key dependency)
CREATE TABLE IF NOT EXISTS stories (
    id text PRIMARY KEY,
    title text NOT NULL,
    description text,
    acceptance_criteria jsonb DEFAULT '[]',
    technical_requirements jsonb DEFAULT '{}',
    priority integer DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
    complexity integer DEFAULT 3 CHECK (complexity >= 1 AND complexity <= 5),
    estimated_hours integer,
    tags text[] DEFAULT '{}',
    repository_url text,
    jira_ticket_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Mentorship Sessions Table
-- Tracks the state and progress of each mentorship session
CREATE TABLE IF NOT EXISTS mentorship_sessions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id text NOT NULL REFERENCES stories(id),
    junior_id text NOT NULL REFERENCES junior_developers(id),
    current_state text NOT NULL DEFAULT 'INIT_STORY_PROCESSING',
    previous_state text,
    context jsonb DEFAULT '{}',
    variables jsonb DEFAULT '{}',
    workflow_instance_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    row_version bytea NOT NULL DEFAULT '\x',
    status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'paused', 'cancelled'))
);

-- Mentorship Events Table
-- Logs all events and state transitions during a mentorship session
CREATE TABLE IF NOT EXISTS mentorship_events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id uuid REFERENCES mentorship_sessions(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    event_data jsonb,
    state_from text,
    state_to text,
    trigger text,
    created_at timestamptz DEFAULT now()
);

-- Mentorship Analytics Table
-- Stores metrics and analytics data for sessions
CREATE TABLE IF NOT EXISTS mentorship_analytics (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id uuid REFERENCES mentorship_sessions(id) ON DELETE SET NULL,
    junior_id text REFERENCES junior_developers(id) ON DELETE SET NULL,
    metric_name text NOT NULL,
    metric_value numeric,
    metric_unit text,
    metadata jsonb DEFAULT '{}',
    recorded_at timestamptz DEFAULT now()
);

-- Blocker History Table
-- Tracks blockers encountered during mentorship
CREATE TABLE IF NOT EXISTS blocker_history (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id uuid REFERENCES mentorship_sessions(id) ON DELETE CASCADE,
    blocker_type text NOT NULL,
    description text,
    resolution text,
    time_to_resolve interval,
    assistance_level integer CHECK (assistance_level >= 1 AND assistance_level <= 5),
    created_at timestamptz DEFAULT now(),
    resolved_at timestamptz
);

-- Quality Gate Results Table
-- Stores results from quality gate checks
CREATE TABLE IF NOT EXISTS quality_gate_results (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id uuid REFERENCES mentorship_sessions(id) ON DELETE CASCADE,
    gate_type text NOT NULL,
    passed boolean NOT NULL,
    score numeric,
    issues jsonb DEFAULT '[]',
    suggestions jsonb DEFAULT '[]',
    created_at timestamptz DEFAULT now()
);

-- Code Review Records Table
-- Tracks code review history
CREATE TABLE IF NOT EXISTS code_review_records (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id uuid REFERENCES mentorship_sessions(id) ON DELETE CASCADE,
    pull_request_url text,
    review_status text CHECK (review_status IN ('pending', 'approved', 'changes_requested', 'rejected')),
    reviewer_comments jsonb DEFAULT '[]',
    iterations integer DEFAULT 1,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    completed_at timestamptz
);

-- =============================================================================
-- Indexes for Performance
-- =============================================================================

-- Mentorship Sessions Indexes
CREATE INDEX IF NOT EXISTS idx_mentorship_sessions_junior_id ON mentorship_sessions(junior_id);
CREATE INDEX IF NOT EXISTS idx_mentorship_sessions_story_id ON mentorship_sessions(story_id);
CREATE INDEX IF NOT EXISTS idx_mentorship_sessions_current_state ON mentorship_sessions(current_state);
CREATE INDEX IF NOT EXISTS idx_mentorship_sessions_status ON mentorship_sessions(status);
CREATE INDEX IF NOT EXISTS idx_mentorship_sessions_created_at ON mentorship_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_mentorship_sessions_workflow_instance_id ON mentorship_sessions(workflow_instance_id);

-- Mentorship Events Indexes
CREATE INDEX IF NOT EXISTS idx_mentorship_events_session_id ON mentorship_events(session_id);
CREATE INDEX IF NOT EXISTS idx_mentorship_events_event_type ON mentorship_events(event_type);
CREATE INDEX IF NOT EXISTS idx_mentorship_events_created_at ON mentorship_events(created_at);

-- Junior Developers Indexes
CREATE INDEX IF NOT EXISTS idx_junior_developers_email ON junior_developers(email);
CREATE INDEX IF NOT EXISTS idx_junior_developers_github_username ON junior_developers(github_username);
CREATE INDEX IF NOT EXISTS idx_junior_developers_skill_level ON junior_developers(skill_level);

-- Stories Indexes
CREATE INDEX IF NOT EXISTS idx_stories_priority ON stories(priority);
CREATE INDEX IF NOT EXISTS idx_stories_complexity ON stories(complexity);
CREATE INDEX IF NOT EXISTS idx_stories_tags ON stories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_stories_jira_ticket_id ON stories(jira_ticket_id);

-- Analytics Indexes
CREATE INDEX IF NOT EXISTS idx_mentorship_analytics_session_id ON mentorship_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_mentorship_analytics_junior_id ON mentorship_analytics(junior_id);
CREATE INDEX IF NOT EXISTS idx_mentorship_analytics_metric_name ON mentorship_analytics(metric_name);
CREATE INDEX IF NOT EXISTS idx_mentorship_analytics_recorded_at ON mentorship_analytics(recorded_at);

-- Blocker History Indexes
CREATE INDEX IF NOT EXISTS idx_blocker_history_session_id ON blocker_history(session_id);
CREATE INDEX IF NOT EXISTS idx_blocker_history_blocker_type ON blocker_history(blocker_type);

-- Quality Gate Results Indexes
CREATE INDEX IF NOT EXISTS idx_quality_gate_results_session_id ON quality_gate_results(session_id);
CREATE INDEX IF NOT EXISTS idx_quality_gate_results_gate_type ON quality_gate_results(gate_type);

-- Code Review Records Indexes
CREATE INDEX IF NOT EXISTS idx_code_review_records_session_id ON code_review_records(session_id);
CREATE INDEX IF NOT EXISTS idx_code_review_records_review_status ON code_review_records(review_status);

-- =============================================================================
-- Functions and Triggers
-- =============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_mentorship_sessions_updated_at
    BEFORE UPDATE ON mentorship_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_junior_developers_updated_at
    BEFORE UPDATE ON junior_developers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stories_updated_at
    BEFORE UPDATE ON stories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_code_review_records_updated_at
    BEFORE UPDATE ON code_review_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to log state transitions
CREATE OR REPLACE FUNCTION log_state_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.current_state IS DISTINCT FROM NEW.current_state THEN
        INSERT INTO mentorship_events (session_id, event_type, state_from, state_to, event_data)
        VALUES (NEW.id, 'state_transition', OLD.current_state, NEW.current_state,
                jsonb_build_object('previous_state', OLD.current_state, 'new_state', NEW.current_state));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER log_mentorship_state_transition
    AFTER UPDATE ON mentorship_sessions
    FOR EACH ROW
    EXECUTE FUNCTION log_state_transition();

-- Function to update junior developer stats
CREATE OR REPLACE FUNCTION update_junior_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        UPDATE junior_developers
        SET total_sessions = total_sessions + 1,
            successful_sessions = successful_sessions + 1
        WHERE id = NEW.junior_id;
    ELSIF NEW.status = 'failed' AND OLD.status != 'failed' THEN
        UPDATE junior_developers
        SET total_sessions = total_sessions + 1
        WHERE id = NEW.junior_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_junior_developer_stats
    AFTER UPDATE ON mentorship_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_junior_stats();

-- =============================================================================
-- Views for Common Queries
-- =============================================================================

-- Active Sessions View
CREATE OR REPLACE VIEW active_sessions AS
SELECT
    ms.id,
    ms.story_id,
    ms.junior_id,
    jd.name as junior_name,
    s.title as story_title,
    ms.current_state,
    ms.status,
    ms.created_at,
    ms.updated_at,
    EXTRACT(EPOCH FROM (now() - ms.created_at)) / 3600 as hours_elapsed
FROM mentorship_sessions ms
LEFT JOIN junior_developers jd ON ms.junior_id = jd.id
LEFT JOIN stories s ON ms.story_id = s.id
WHERE ms.status = 'active';

-- Session Summary View
CREATE OR REPLACE VIEW session_summary AS
SELECT
    ms.id,
    ms.story_id,
    ms.junior_id,
    jd.name as junior_name,
    s.title as story_title,
    ms.current_state,
    ms.status,
    ms.created_at,
    ms.completed_at,
    EXTRACT(EPOCH FROM (COALESCE(ms.completed_at, now()) - ms.created_at)) / 3600 as total_hours,
    (SELECT COUNT(*) FROM mentorship_events WHERE session_id = ms.id) as event_count,
    (SELECT COUNT(*) FROM blocker_history WHERE session_id = ms.id) as blocker_count
FROM mentorship_sessions ms
LEFT JOIN junior_developers jd ON ms.junior_id = jd.id
LEFT JOIN stories s ON ms.story_id = s.id;

-- Junior Developer Progress View
CREATE OR REPLACE VIEW junior_progress AS
SELECT
    jd.id,
    jd.name,
    jd.skill_level,
    jd.total_sessions,
    jd.successful_sessions,
    CASE
        WHEN jd.total_sessions > 0
        THEN ROUND((jd.successful_sessions::numeric / jd.total_sessions) * 100, 2)
        ELSE 0
    END as success_rate,
    (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)
     FROM mentorship_sessions
     WHERE junior_id = jd.id AND status = 'completed') as avg_completion_hours
FROM junior_developers jd;

-- =============================================================================
-- Initial Data (Optional - for development)
-- =============================================================================

-- Insert sample junior developer for testing
INSERT INTO junior_developers (id, name, email, github_username, skill_level)
VALUES
    ('dev-001', 'Test Developer', 'test@example.com', 'testdev', 2)
ON CONFLICT (id) DO NOTHING;

-- Insert sample story for testing
INSERT INTO stories (id, title, description, complexity, priority, acceptance_criteria)
VALUES
    ('story-001', 'Sample User Authentication',
     'Implement user authentication with JWT tokens',
     3, 2,
     '["User can register with email and password", "User can login and receive JWT token", "Protected routes require valid JWT"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Grant permissions (adjust as needed for your setup)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tamma;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tamma;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tamma;
