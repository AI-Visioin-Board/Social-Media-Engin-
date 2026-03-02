CREATE TABLE `content_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runSlot` enum('monday','friday') NOT NULL,
	`status` enum('pending','discovering','scoring','researching','generating','assembling','review','posting','completed','failed') NOT NULL DEFAULT 'pending',
	`topicsRaw` text,
	`topicsShortlisted` text,
	`topicsSelected` text,
	`errorMessage` text,
	`adminApproved` boolean NOT NULL DEFAULT false,
	`instagramPostId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `content_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `generated_slides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`slideIndex` int NOT NULL,
	`headline` varchar(500),
	`summary` text,
	`citations` text,
	`videoUrl` varchar(1000),
	`assembledUrl` varchar(1000),
	`videoPrompt` text,
	`status` enum('pending','researching','generating_video','assembling','ready','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `generated_slides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `published_topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`title` varchar(500) NOT NULL,
	`summary` text,
	`titleNormalized` varchar(500) NOT NULL,
	`publishedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `published_topics_id` PRIMARY KEY(`id`)
);
