CREATE TABLE `pdfIndexes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fileId` int NOT NULL,
	`status` enum('PENDING','INDEXING','READY','ERROR') NOT NULL DEFAULT 'PENDING',
	`chunkCount` int DEFAULT 0,
	`checksum` varchar(32),
	`indexPath` varchar(512),
	`errorMessage` text,
	`progress` int DEFAULT 0,
	`indexedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pdfIndexes_id` PRIMARY KEY(`id`),
	CONSTRAINT `pdfIndexes_fileId_unique` UNIQUE(`fileId`)
);
--> statement-breakpoint
CREATE TABLE `pdfMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` varchar(36) NOT NULL,
	`role` enum('user','assistant','system') NOT NULL,
	`content` text NOT NULL,
	`tokenCount` int DEFAULT 0,
	`citations` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pdfMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pdfThreads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`threadId` varchar(36) NOT NULL,
	`fileId` int NOT NULL,
	`title` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pdfThreads_id` PRIMARY KEY(`id`),
	CONSTRAINT `pdfThreads_threadId_unique` UNIQUE(`threadId`)
);
--> statement-breakpoint
ALTER TABLE `pdfFiles` ADD `contentChecksum` varchar(32);