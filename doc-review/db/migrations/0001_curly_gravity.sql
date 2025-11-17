PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_discussions` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_path` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'open' NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_discussions`("id", "doc_path", "title", "description", "status", "user_id", "session_id", "created_at", "updated_at", "deleted_at") SELECT "id", "doc_path", "title", "description", "status", "user_id", "session_id", "created_at", "updated_at", "deleted_at" FROM `discussions`;--> statement-breakpoint
DROP TABLE `discussions`;--> statement-breakpoint
ALTER TABLE `__new_discussions` RENAME TO `discussions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_path` text NOT NULL,
	`line_start` integer NOT NULL,
	`line_end` integer NOT NULL,
	`original_text` text NOT NULL,
	`suggested_text` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`user_id` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_suggestions`("id", "doc_path", "line_start", "line_end", "original_text", "suggested_text", "description", "status", "reviewed_by", "reviewed_at", "user_id", "session_id", "created_at", "updated_at", "deleted_at") SELECT "id", "doc_path", "line_start", "line_end", "original_text", "suggested_text", "description", "status", "reviewed_by", "reviewed_at", "user_id", "session_id", "created_at", "updated_at", "deleted_at" FROM `suggestions`;--> statement-breakpoint
DROP TABLE `suggestions`;--> statement-breakpoint
ALTER TABLE `__new_suggestions` RENAME TO `suggestions`;--> statement-breakpoint
ALTER TABLE `comments` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `discussion_messages` ADD `deleted_at` integer;