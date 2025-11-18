-- Create webhook_events table for storing webhook audit trail
CREATE TABLE IF NOT EXISTS `webhook_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `provider` TEXT NOT NULL CHECK(`provider` IN ('github', 'gitlab', 'bitbucket')),
  `event_type` TEXT NOT NULL,
  `event_action` TEXT,
  `payload` TEXT NOT NULL, -- JSON string of the full webhook payload
  `signature` TEXT, -- Webhook signature for verification audit
  `headers` TEXT, -- JSON string of webhook headers
  `processed` INTEGER NOT NULL DEFAULT 0, -- 0 = unprocessed, 1 = processed, -1 = failed
  `processed_at` INTEGER,
  `error` TEXT, -- Error message if processing failed
  `retry_count` INTEGER NOT NULL DEFAULT 0,
  `pr_number` INTEGER, -- Extracted PR/MR number for quick queries
  `branch` TEXT, -- Extracted branch name for quick queries
  `repository` TEXT, -- Repository identifier
  `sender_username` TEXT, -- Username of the event sender
  `created_at` INTEGER NOT NULL,
  `ip_address` TEXT, -- Source IP for security audit
  `user_agent` TEXT -- User agent for webhook delivery
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS `idx_webhook_events_provider` ON `webhook_events`(`provider`);
CREATE INDEX IF NOT EXISTS `idx_webhook_events_event_type` ON `webhook_events`(`event_type`);
CREATE INDEX IF NOT EXISTS `idx_webhook_events_processed` ON `webhook_events`(`processed`);
CREATE INDEX IF NOT EXISTS `idx_webhook_events_pr_number` ON `webhook_events`(`pr_number`);
CREATE INDEX IF NOT EXISTS `idx_webhook_events_branch` ON `webhook_events`(`branch`);
CREATE INDEX IF NOT EXISTS `idx_webhook_events_created_at` ON `webhook_events`(`created_at`);

-- Create webhook_configurations table for storing webhook settings
CREATE TABLE IF NOT EXISTS `webhook_configurations` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `provider` TEXT NOT NULL UNIQUE CHECK(`provider` IN ('github', 'gitlab', 'bitbucket')),
  `webhook_url` TEXT NOT NULL,
  `secret` TEXT NOT NULL, -- Encrypted webhook secret/token
  `events` TEXT NOT NULL, -- JSON array of subscribed events
  `active` INTEGER NOT NULL DEFAULT 1,
  `last_delivery_at` INTEGER,
  `last_delivery_status` TEXT,
  `failure_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL
);

-- Create webhook_deliveries table for tracking delivery attempts
CREATE TABLE IF NOT EXISTS `webhook_deliveries` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `event_id` TEXT NOT NULL,
  `status` TEXT NOT NULL CHECK(`status` IN ('pending', 'success', 'failed', 'timeout')),
  `response_status` INTEGER,
  `response_body` TEXT,
  `duration_ms` INTEGER,
  `attempt_number` INTEGER NOT NULL DEFAULT 1,
  `created_at` INTEGER NOT NULL,
  FOREIGN KEY(`event_id`) REFERENCES `webhook_events`(`id`)
);

-- Create index for webhook deliveries
CREATE INDEX IF NOT EXISTS `idx_webhook_deliveries_event_id` ON `webhook_deliveries`(`event_id`);
CREATE INDEX IF NOT EXISTS `idx_webhook_deliveries_status` ON `webhook_deliveries`(`status`);