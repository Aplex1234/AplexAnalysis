CREATE TABLE `peer_selection_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`target_listing_id` text NOT NULL,
	`source_provider` text NOT NULL,
	`source_url` text NOT NULL,
	`source_as_of` text NOT NULL,
	`selection_version` text NOT NULL,
	`target_sector` text,
	`target_industry` text,
	`candidate_count` integer NOT NULL,
	`selected_count` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`target_listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_peer_selection_runs_target_created_at` ON `peer_selection_runs` (`target_listing_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `peer_selections` (
	`run_id` text NOT NULL,
	`peer_ticker` text NOT NULL,
	`peer_name` text NOT NULL,
	`rank` integer NOT NULL,
	`score_basis_points` integer NOT NULL,
	`reason` text NOT NULL,
	`factors_json` text NOT NULL,
	`source_label` text NOT NULL,
	`source_url` text NOT NULL,
	`market_cap` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`run_id`, `peer_ticker`),
	FOREIGN KEY (`run_id`) REFERENCES `peer_selection_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_peer_selections_peer_ticker` ON `peer_selections` (`peer_ticker`);