ALTER TABLE `content_runs` MODIFY COLUMN `status` enum('pending','discovering','scoring','researching','generating','assembling','review','pending_post','posting','completed','failed') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `content_runs` ADD `instagramCaption` text;--> statement-breakpoint
ALTER TABLE `content_runs` ADD `postApproved` boolean DEFAULT false NOT NULL;