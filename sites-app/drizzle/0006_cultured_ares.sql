CREATE TABLE `cache_refresh_leases` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cache_refresh_leases_expires_at` ON `cache_refresh_leases` (`expires_at`);