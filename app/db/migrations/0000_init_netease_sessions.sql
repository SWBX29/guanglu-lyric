CREATE TABLE `netease_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`netease_cookie` text NOT NULL,
	`netease_user_id` text DEFAULT '' NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
