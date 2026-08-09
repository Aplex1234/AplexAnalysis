CREATE TABLE `reference_data_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`provider` text NOT NULL,
	`source_version` text NOT NULL,
	`fetched_at` text NOT NULL,
	`fresh_until` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reference_data_cache_fresh_until` ON `reference_data_cache` (`fresh_until`);