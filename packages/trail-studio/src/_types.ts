// shared shapes entre server e client. fonte única; client importa daqui via Vite,
// server importa daqui em vez de redeclarar. arquivo `_*` não vai pro exports map.

// espelha @juicerq/trail/core's SEVERITIES — não importa direto pra evitar pull do
// node:async_hooks/os no bundle do client. mantém sync se o core mudar.
export const SEVERITIES = ["debug", "info", "warn", "error", "fatal"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type StudioColumn = {
	name: string;
	type: string;
	indexed: boolean;
	base: boolean;
};

export type StudioStats = {
	total: number;
	oldest: number | null;
	newest: number | null;
};

export type StudioSchema = {
	columns: StudioColumn[];
	stats: StudioStats;
};

export type StudioEvent = {
	id: string;
	timestamp: number;
	severity: string;
	type: string;
	service: string;
	hostname: string;
	parent_id: string | null;
	error: unknown;
	extra: unknown;
} & Record<string, unknown>;

export type EventsResult = {
	events: StudioEvent[];
	nextCursor: string | null;
	hasMore: boolean;
};

export type CountResult = {
	count: number;
};

export type TraceResult = {
	event: StudioEvent;
	ancestors: StudioEvent[];
	children: StudioEvent[];
};

export type DistinctResult = {
	values: Array<string | number | null>;
	hasMore: boolean;
};

export type StudioConfig = {
	liveTail: boolean;
};
