import { Database } from "bun:sqlite";

export function makeDb() {
	const db = new Database(":memory:");

	db.run(`
		CREATE TABLE events (
			id TEXT PRIMARY KEY,
			timestamp INTEGER NOT NULL,
			severity TEXT NOT NULL,
			type TEXT NOT NULL,
			service TEXT NOT NULL,
			hostname TEXT NOT NULL,
			parent_id TEXT,
			error TEXT,
			procedure TEXT,
			duration_ms INTEGER,
			extra TEXT
		)
	`);
	db.run("CREATE INDEX idx_events_timestamp ON events(timestamp)");
	db.run("CREATE INDEX idx_events_severity ON events(severity)");
	db.run("CREATE INDEX idx_events_type ON events(type)");
	db.run("CREATE INDEX idx_events_parent_id ON events(parent_id)");
	db.run("CREATE INDEX idx_events_procedure ON events(procedure)");
	db.run("CREATE INDEX idx_events_duration_ms ON events(duration_ms)");

	return db;
}

export function insertEvent(
	db: Database,
	event: {
		id: string;
		timestamp: number;
		severity?: string;
		type?: string;
		parent_id?: string | null;
		procedure?: string | null;
		duration_ms?: number | null;
		error?: unknown;
		extra?: unknown;
	},
) {
	db.run(
		`INSERT INTO events (
			id, timestamp, severity, type, service, hostname, parent_id, error, procedure, duration_ms, extra
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			event.id,
			event.timestamp,
			event.severity ?? "info",
			event.type ?? "http",
			"api",
			"host",
			event.parent_id ?? null,
			event.error === undefined ? null : JSON.stringify(event.error),
			event.procedure ?? null,
			event.duration_ms ?? null,
			event.extra === undefined ? null : JSON.stringify(event.extra),
		],
	);
}
