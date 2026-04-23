import { AsyncLocalStorage } from "node:async_hooks";
import { hostname as osHostname } from "node:os";

export type Severity = "debug" | "info" | "warn" | "error" | "fatal";

export type BaseEvent = {
	id: string;
	timestamp: number;
	severity: Severity;
	type: string;
	service: string;
	hostname: string;
	parent_id?: string;
	error?: {
		message: string;
		stack?: string;
		code?: string | number;
	};
};

export type Store<E extends BaseEvent> = {
	write(event: E): Promise<void> | void;
	flush?(): Promise<void>;
	cleanup?(): Promise<void>;
};

type ManagedKeys = "id" | "timestamp" | "service" | "hostname" | "parent_id" | "error";

type InputEvent<E extends BaseEvent> = Omit<E, ManagedKeys | "severity"> & {
	severity?: Severity;
};

type EnrichFields<E extends BaseEvent> = Partial<Omit<E, ManagedKeys>>;

type ScopeState<E extends BaseEvent> = {
	event: E;
	suppressed: boolean;
};

const severityOrder: Record<Severity, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	fatal: 4,
};

const toErrorPayload = (err: unknown): NonNullable<BaseEvent["error"]> => {
	if (!(err instanceof Error)) {
		return { message: String(err) };
	}

	const payload: NonNullable<BaseEvent["error"]> = { message: err.message };

	if (err.stack !== undefined) {
		payload.stack = err.stack;
	}

	const code = (err as { code?: unknown }).code;

	if (typeof code === "string" || typeof code === "number") {
		payload.code = code;
	}

	return payload;
};

export function createObservability<E extends BaseEvent>(config: {
	service: string;
	strict?: boolean;
	store: Store<E>;
}) {
	const als = new AsyncLocalStorage<ScopeState<E>>();
	const pending = new Set<Promise<unknown>>();
	const hostname = osHostname();
	const strict = config.strict ?? false;

	let warned = false;

	const track = (result: Promise<void> | void): Promise<void> => {
		const p = Promise.resolve(result);

		pending.add(p);
		void p.finally(() => pending.delete(p));

		return p;
	};

	const buildEvent = (fields: InputEvent<E>, parentId: string | undefined): E => {
		const base = {
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			severity: "info" as Severity,
			service: config.service,
			hostname,
			...(fields as object),
		};

		if (parentId !== undefined) {
			(base as { parent_id?: string }).parent_id = parentId;
		}

		return base as E;
	};

	const requireScope = (verb: string): ScopeState<E> | undefined => {
		const state = als.getStore();

		if (state) return state;

		if (strict) {
			throw new Error(`obs.${verb} chamado fora de obs.context`);
		}

		if (!warned) {
			warned = true;
			console.warn(
				`[trail] obs.${verb} chamado fora de obs.context — ignorado (ative strict:true para throw)`,
			);
		}

		return undefined;
	};

	return {
		async context<T>(fields: InputEvent<E>, fn: () => Promise<T> | T): Promise<T> {
			const parent = als.getStore();
			const event = buildEvent(fields, parent?.event.id);
			const state: ScopeState<E> = { event, suppressed: false };

			let autoCapturedError = false;

			try {
				return await als.run(state, async () => {
					try {
						return await fn();
					} catch (err) {
						state.event.severity = "error";
						state.event.error = toErrorPayload(err);
						autoCapturedError = true;

						throw err;
					}
				});
			} finally {
				// exceções auto-capturadas sobrepõem suppress —
				// supressão bruta é pra sucesso ruidoso, não pra esconder erros
				if (!state.suppressed || autoCapturedError) {
					await track(config.store.write(state.event));
				}
			}
		},

		enrich(fields: EnrichFields<E>) {
			const state = requireScope("enrich");

			if (!state) return;

			Object.assign(state.event, fields);
		},

		async emit(fields: InputEvent<E>): Promise<void> {
			// emit dentro de scope herda parent_id do scope corrente (top-level caso contrário)
			const parent = als.getStore();
			const event = buildEvent(fields, parent?.event.id);

			await track(config.store.write(event));
		},

		escalate(severity: Severity) {
			const state = requireScope("escalate");

			if (!state) return;

			if (severityOrder[severity] > severityOrder[state.event.severity]) {
				state.event.severity = severity;
			}
		},

		suppress() {
			const state = requireScope("suppress");

			if (!state) return;

			state.suppressed = true;
		},

		async flush(): Promise<void> {
			// loop drena writes disparados durante a espera
			while (pending.size > 0) {
				await Promise.all(pending);
			}

			if (config.store.flush) {
				await config.store.flush();
			}
		},

		async cleanup(): Promise<void> {
			if (config.store.cleanup) {
				await config.store.cleanup();
			}
		},

		// leitura do evento corrente (pra adapters decidirem suppress/onEvent antes do write)
		currentEvent(): Readonly<E> | undefined {
			return als.getStore()?.event;
		},
	};
}

export type Observability<E extends BaseEvent> = ReturnType<typeof createObservability<E>>;
