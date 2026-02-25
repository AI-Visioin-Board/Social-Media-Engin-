CREATE TABLE `deliverables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`phase` enum('onboarding','ai_audit','gbp_optimization','schema_markup','citation_audit','review_strategy','content_optimization','competitor_analysis','final_report','follow_up') NOT NULL,
	`name` varchar(255) NOT NULL,
	`fileUrl` varchar(1000) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`mimeType` varchar(100),
	`fileSize` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deliverables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`sender` enum('client','admin') NOT NULL,
	`content` text NOT NULL,
	`isProcessed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientName` varchar(255) NOT NULL,
	`clientEmail` varchar(320) NOT NULL,
	`businessName` varchar(255) NOT NULL,
	`websiteUrl` varchar(500),
	`businessAddress` varchar(500),
	`businessPhone` varchar(50),
	`businessCategory` varchar(255),
	`targetArea` varchar(255),
	`serviceTier` enum('ai_jumpstart','ai_dominator') NOT NULL,
	`status` enum('pending','processing','completed','cancelled') NOT NULL DEFAULT 'pending',
	`currentPhase` enum('onboarding','ai_audit','gbp_optimization','schema_markup','citation_audit','review_strategy','content_optimization','competitor_analysis','final_report','follow_up') NOT NULL DEFAULT 'onboarding',
	`welcomeEmailSent` boolean NOT NULL DEFAULT false,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `phase_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`phase` enum('onboarding','ai_audit','gbp_optimization','schema_markup','citation_audit','review_strategy','content_optimization','competitor_analysis','final_report','follow_up') NOT NULL,
	`qaExecute` boolean NOT NULL DEFAULT false,
	`qaVerify` boolean NOT NULL DEFAULT false,
	`qaTest` boolean NOT NULL DEFAULT false,
	`qaDocument` boolean NOT NULL DEFAULT false,
	`notes` text,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `phase_progress_id` PRIMARY KEY(`id`)
);
