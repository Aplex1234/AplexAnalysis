CREATE TABLE `price_history_cache` (
	`ticker` text NOT NULL,
	`range` text NOT NULL,
	`payload_json` text NOT NULL,
	`provider` text NOT NULL,
	`source_version` text NOT NULL,
	`fetched_at` text NOT NULL,
	`fresh_until` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`ticker`, `range`)
);
--> statement-breakpoint
CREATE INDEX `idx_price_history_cache_fresh_until` ON `price_history_cache` (`fresh_until`);