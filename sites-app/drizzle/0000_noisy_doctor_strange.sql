CREATE TABLE `analysis_cache` (
	`listing_id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`generated_at` text NOT NULL,
	`fresh_until` text NOT NULL,
	`refresh_started_at` text,
	`last_refresh_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_cache_fresh_until` ON `analysis_cache` (`fresh_until`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`cik` text NOT NULL,
	`name` text NOT NULL,
	`sector` text,
	`industry` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_cik` ON `companies` (`cik`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`ticker` text NOT NULL,
	`exchange` text,
	`is_primary` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_listings_exchange_ticker` ON `listings` (`exchange`,`ticker`);--> statement-breakpoint
CREATE INDEX `idx_listings_ticker` ON `listings` (`ticker`);--> statement-breakpoint
CREATE INDEX `idx_listings_company_id` ON `listings` (`company_id`);--> statement-breakpoint
CREATE TABLE `normalized_financial_cache` (
	`company_id` text PRIMARY KEY NOT NULL,
	`annual_json` text NOT NULL,
	`quarterly_json` text NOT NULL,
	`filings_json` text NOT NULL,
	`latest_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`normalization_version` text NOT NULL,
	`normalized_at` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
