#!/usr/bin/env bun

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { createStudioApp } from "./server/app";
import { describeColumns, describeStats } from "./server/schema";

const VERSION = "0.1.4";

const cliSchema = z.object({
	dbPath: z.string().min(1),
	port: z.number().int().positive().optional(),
	host: z.string().min(1),
	open: z.boolean(),
	live: z.boolean(),
});

type CliOptions = z.infer<typeof cliSchema>;

const usage = `trail-studio v${VERSION}

Uso:
  bunx @juicerq/trail-studio [opções]

Opções:
  --db <path>         caminho do arquivo .db (default: ./obs.db ou $DB_PATH)
  --port <n>          port fixo (default: random disponível)
  --host <ip>         bind address (default: 127.0.0.1)
  --no-open           não abre browser
  --no-live           live tail desligado na boot
  --help              mostra esta ajuda
`;

function requireValue(arg: string, value: string | undefined): string {
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`Opção ${arg} requer um valor`);
	}
	return value;
}

function parseArgs(args: string[]): CliOptions | "help" {
	const raw: Record<string, unknown> = {
		dbPath: process.env.DB_PATH ?? "./obs.db",
		host: "127.0.0.1",
		open: true,
		live: true,
	};

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i] as string;

		if (arg === "--help" || arg === "-h") return "help";
		else if (arg === "--no-open") raw.open = false;
		else if (arg === "--no-live") raw.live = false;
		else if (arg === "--db") raw.dbPath = requireValue(arg, args[++i]);
		else if (arg === "--host") raw.host = requireValue(arg, args[++i]);
		else if (arg === "--port") raw.port = Number(requireValue(arg, args[++i]));
		else throw new Error(`Opção desconhecida: ${arg}`);
	}

	return cliSchema.parse(raw);
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

function fail(message: string): never {
	console.error(`trail-studio: ${message}`);
	process.exit(1);
}

let opts: CliOptions | "help";

try {
	opts = parseArgs(Bun.argv.slice(2));
} catch (err) {
	fail(err instanceof Error ? err.message : String(err));
}

if (opts === "help") {
	console.log(usage);
	process.exit(0);
}

const dbPath = resolve(opts.dbPath);

if (!existsSync(dbPath)) {
	fail(`arquivo do DB não existe: ${dbPath}\n  use --db <path> pra apontar pro seu obs.db`);
}

let db: Database;
try {
	db = new Database(dbPath, { readonly: true });
} catch (err) {
	fail(`falha ao abrir ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
}

let columns;
let stats;
try {
	columns = describeColumns(db);
	stats = describeStats(db);
} catch (err) {
	fail(`schema inválido em ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
}

const clientDir = resolve(import.meta.dir, "../dist/client");

if (!existsSync(clientDir)) {
	fail(`bundle do client não encontrado em ${clientDir}\n  rode 'bun run build' antes`);
}

const server = Bun.serve({
	hostname: opts.host,
	port: opts.port ?? 0,
	fetch: createStudioApp(db, columns, clientDir, { liveTail: opts.live }).fetch,
});
const url = `http://${opts.host}:${server.port}`;
const size = formatBytes(statSync(dbPath).size);

console.log(`trail-studio v${VERSION}
  db:        ${opts.dbPath} (${size}, ${stats.total.toLocaleString()} events)
  listening: ${url}
  live tail: ${opts.live ? "on" : "off"}`);

if (opts.open) {
	openBrowser(url);
}

const shutdown = () => {
	server.stop();
	db.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
