CREATE TABLE `job_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`page_index` integer NOT NULL,
	`result_key` text NOT NULL,
	`status` text NOT NULL,
	`engine` text NOT NULL,
	`credits` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_pages_job_index` ON `job_pages` (`job_id`,`page_index`);