CREATE TABLE `cache_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` text,
	`ticker` text NOT NULL,
	`component` text NOT NULL,
	`outcome` text NOT NULL,
	`duration_ms` integer,
	`json_bytes` integer,
	`provider` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cache_events_component_created_at` ON `cache_events` (`component`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cache_events_listing_created_at` ON `cache_events` (`listing_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cache_refresh_schedule` (
	`listing_id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`view_count` integer DEFAULT 1 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` text NOT NULL,
	`next_refresh_at` text NOT NULL,
	`last_scheduled_refresh` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cache_refresh_schedule_due` ON `cache_refresh_schedule` (`next_refresh_at`,`priority`,`view_count`);--> statement-breakpoint
CREATE TABLE `component_cache` (
	`listing_id` text NOT NULL,
	`component` text NOT NULL,
	`payload_json` text NOT NULL,
	`provider` text,
	`source_version` text NOT NULL,
	`fetched_at` text NOT NULL,
	`fresh_until` text NOT NULL,
	`last_successful_refresh` text NOT NULL,
	`last_refresh_error` text,
	`json_bytes` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`listing_id`, `component`),
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_component_cache_component_fresh_until` ON `component_cache` (`component`,`fresh_until`);--> statement-breakpoint
ALTER TABLE `analysis_cache` ADD `normalization_version` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_cache` ADD `valuation_model_version` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_cache` ADD `score_model_version` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `analysis_cache` ADD `last_successful_refresh` text;--> statement-breakpoint
ALTER TABLE `analysis_cache` ADD `json_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `normalized_financial_cache` ADD `profile_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `normalized_financial_cache` ADD `risks_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `normalized_financial_cache` ADD `source_fingerprint` text;--> statement-breakpoint
ALTER TABLE `normalized_financial_cache` ADD `source_filing_at` text;--> statement-breakpoint
ALTER TABLE `normalized_financial_cache` ADD `fresh_until` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
