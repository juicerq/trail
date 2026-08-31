import type {
	CountResult,
	DistinctResult,
	EventsResult,
	StudioConfig,
	StudioSchema,
	TraceResult,
} from "../_types";

// re-export pra hooks/componentes consumirem sem cruzar a barreira interna
export type {
	CountResult,
	DistinctResult,
	EventsResult,
	StudioColumn,
	StudioConfig,
	StudioEvent,
	StudioSchema,
	TraceResult,
} from "../_types";

async function fetchJson<T>(path: string): Promise<T> {
	const response = await fetch(path);

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? `Request failed: ${response.status}`);
	}

	return response.json() as Promise<T>;
}

function paramsToString(params: URLSearchParams): string {
	const str = params.toString();
	return str ? `?${str}` : "";
}

export const api = {
	config: () => fetchJson<StudioConfig>("/api/config"),
	schema: () => fetchJson<StudioSchema>("/api/schema"),
	events: (params: URLSearchParams) =>
		fetchJson<EventsResult>(`/api/events${paramsToString(params)}`),
	count: (params: URLSearchParams) => fetchJson<CountResult>(`/api/count${paramsToString(params)}`),
	distinct: (column: string) =>
		fetchJson<DistinctResult>(`/api/distinct?column=${encodeURIComponent(column)}&limit=50`),
	trace: (id: string) => fetchJson<TraceResult>(`/api/events/${encodeURIComponent(id)}/trace`),
};
