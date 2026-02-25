CREATE TABLE `client_access_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`token` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `client_access_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_access_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `client_uploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`fileUrl` varchar(1000) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`mimeType` varchar(100),
	`fileSize` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `client_uploads_id` PRIMARY KEY(`id`)
);
