CREATE TABLE `benchmark_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_provider` text,
	`model_name` text,
	`task_id` text NOT NULL,
	`generated_code` text,
	`raw_response` text,
	`compiles` integer,
	`test_pass_rate` integer,
	`code_quality_score` integer,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` integer,
	`staff_score` integer,
	`user_score` integer,
	`self_review_score` integer,
	`team_review_score` integer,
	`final_score` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `benchmark_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `test_bank`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `benchmark_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`total_models` integer NOT NULL,
	`total_tasks` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `judge_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`benchmark_result_id` text NOT NULL,
	`judge_model` text NOT NULL,
	`judge_role` text NOT NULL,
	`score` integer NOT NULL,
	`weight` integer NOT NULL,
	`reasoning` text,
	`critical_issues` text,
	`suggestions` text,
	`reviewed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`benchmark_result_id`) REFERENCES `benchmark_results`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `staff_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`reviewer_id` text NOT NULL,
	`benchmark_result_id` text NOT NULL,
	`correctness` integer NOT NULL,
	`code_quality` integer NOT NULL,
	`best_practices` integer NOT NULL,
	`efficiency` integer NOT NULL,
	`overall_score` integer NOT NULL,
	`notes` text,
	`reviewed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`benchmark_result_id`) REFERENCES `benchmark_results`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `test_bank` (
	`id` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`scenario` text NOT NULL,
	`difficulty` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`prompt` text NOT NULL,
	`starter_code` text,
	`solution` text NOT NULL,
	`test_suite` text NOT NULL,
	`expected_metrics` text,
	`primary_role` text DEFAULT 'developer' NOT NULL,
	`role_evaluations` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_by` text,
	`tags` text,
	`source` text
);
--> statement-breakpoint
CREATE TABLE `user_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`benchmark_result_id` text NOT NULL,
	`vote` text NOT NULL,
	`comment` text,
	`reviewed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`benchmark_result_id`) REFERENCES `benchmark_results`(`id`) ON UPDATE no action ON DELETE cascade
);
