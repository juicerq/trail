export type StudioColumn = {
	name: string;
	type: string;
	indexed: boolean;
	base: boolean;
};

export type StudioSchema = {
	columns: StudioColumn[];
	stats: {
		total: number;
		oldest: number | null;
		newest: number | null;
	};
};

export type StudioEvent = Record<string, unknown> & {
	id: string;
	timestamp: number;
	severity: string;
	type: string;
	service: string;
	hostname: string;
	parent_id: string | null;
	error: unknown;
	extra: unknown;
};

export type EventsResponse = {
	events: StudioEvent[];
	nextCursor: string | null;
	hasMore: boolean;
};

export type TraceResponse = {
	event: StudioEvent;
	ancestors: StudioEvent[];
	children: StudioEvent[];
};

async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(path);

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `Request failed: ${response.status}`);
	}

	return response.json() as Promise<T>;
}

export const api = {
	config: () => fetchJson<{ liveTail: boolean }>("/api/config"),
	schema: () => fetchJson<StudioSchema>("/api/schema"),
	events: (params: URLSearchParams) => fetchJson<EventsResponse>(`/api/events?${params}`),
	distinct: (column: string) =>
		fetchJson<{ values: Array<string | number | null>; hasMore: boolean }>(
			`/api/distinct?column=${encodeURIComponent(column)}&limit=50`,
		),
	trace: (id: string) => fetchJson<TraceResponse>(`/api/events/${encodeURIComponent(id)}/trace`),
};
