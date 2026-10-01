DROP INDEX `usage_unreported_idx`;--> statement-breakpoint
ALTER TABLE `usage_events` ADD `report_skipped_reason` text;--> statement-breakpoint
CREATE INDEX `usage_pending_report_idx` ON `usage_events` (`created_at`,`id`) WHERE ("usage_events"."reported_at" is null and "usage_events"."report_skipped_reason" is null);--> statement-breakpoint
ALTER TABLE `billing_state` ADD `spend_cap_usd` integer;--> statement-breakpoint
CREATE INDEX `jobs_user_status_idx` ON `jobs` (`user_id`,`status`);