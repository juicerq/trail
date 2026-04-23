#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { describeSchema } from "./server/schema";
import { createStudioApp } from "./server/app";

type CliOptions = {
	dbPath: string;
	port?: number;
	host: string;
	open: boolean;
	live: boolean;
	help: boolean;
};

function usage(): string {
	return `trail-studio v0.1.3

Usage:
  bunx @juicerq/trail-studio [options]

Options:
  --db <path>         caminho do arquivo .db (default: ./obs.db)
  --port <n>          port fixo (default: random disponível)
  --host <ip>         bind address (default: 127.0.0.1)
  --no-open           não abre browser
  --no-live           live tail desligado na boot
  --help              mostra esta ajuda
`;
}

function parseArgs(args: string[]): CliOptions {
	const opts: CliOptions = {
		dbPath: process.env.DB_PATH ?? "./obs.db",
		host: "127.0.0.1",
		open: true,
		live: true,
		help: false,
	};

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];

		if (arg === "--help") opts.help = true;
		else if (arg === "--no-open") opts.open = false;
		else if (arg === "--no-live") opts.live = false;
		else if (arg === "--db") opts.dbPath = args[++i] ?? opts.dbPath;
		else if (arg === "--host") opts.host = args[++i] ?? opts.host;
		else if (arg === "--port") {
			const raw = Number(args[++i]);
			if (!Number.isFinite(raw) || raw <= 0) throw new Error("--port must be a positive number");
			opts.port = Math.trunc(raw);
		} else {
			throw new Error(`Unknown option '${arg}'`);
		}
	}

	return opts;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function openBrowser(url: string) {
	const command =
		process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	Bun.spawn([command, ...args], { stdout: "ignore", stderr: "ignore" });
}

const opts = parseArgs(Bun.argv.slice(2));

if (opts.help) {
	console.log(usage());
	process.exit(0);
}

const dbPath = resolve(opts.dbPath);
const db = new Database(dbPath, { readonly: true });
const schema = describeSchema(db);
const clientDir = resolve(import.meta.dir, "../dist/client");
const server = Bun.serve({
	hostname: opts.host,
	port: opts.port ?? 0,
	fetch: createStudioApp(db, clientDir, { liveTail: opts.live }).fetch,
});
const url = `http://${opts.host}:${server.port}`;
const size = formatBytes(statSync(dbPath).size);

console.log(`trail-studio v0.1.3
  db:        ${opts.dbPath} (${size}, ${schema.stats.total.toLocaleString()} events)
  listening: ${url}
  live tail: ${opts.live ? "on" : "off"}`);

if (opts.open) {
	openBrowser(url);
}
