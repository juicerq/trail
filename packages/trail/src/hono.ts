import type { Context, MiddlewareHandler } from "hono";
import type { BaseEvent, Observability } from "./core";
import type { ColumnDef } from "./sqlite";
import { truncateLargeStrings } from "./_truncate";

export type HonoFields = {
	method: string;
	path: string;
	status: number;
	duration_ms: number;
};

// schema padrão pra spread em sqliteStore({ columns }) — sem isso, esses campos caem em extra JSON
export const httpColumns = {
	method: { type: "text" },
	path: { type: "text", index: true },
	status: { type: "integer", index: true },
	duration_ms: { type: "integer", index: true },
} as const satisfies Record<keyof HonoFields, ColumnDef>;

export type HonoMiddlewareOptions<E extends BaseEvent> = {
	slowRequestMs?: number;
	suppressedPaths?: string[];
	expectedStatus?: number[];
	maxFieldBytes?: number;
	onEvent?: (event: Readonly<E>, c: Context) => null | void;
};

export function createHonoMiddleware<E extends BaseEvent & Partial<HonoFields>>(
	obs: Observability<E>,
	opts: HonoMiddlewareOptions<E> = {},
): MiddlewareHandler {
	return async (c, next) => {
		const rawPath = c.req.path;
		const method = c.req.method;

		// cast: projeto precisa ter "http" no E["type"]
		const initial = { type: "http", method, path: rawPath } as unknown as Parameters<
			typeof obs.context
		>[0];

		try {
			await obs.context(initial, async (): Promise<void> => {
				const start = Date.now();

				await next();

				const duration_ms = Date.now() - start;
				const status = c.res.status;

				// pattern da rota (último matchedRoute é o handler)
				const matched = c.req.matchedRoutes;
				const pattern = matched[matched.length - 1]?.path ?? rawPath;

				obs.enrich({ path: pattern, status, duration_ms } as Partial<E>);

				// deriveSeverity padrão (lenient): 5xx → error
				if (status >= 500) obs.escalate("error");

				if (opts.slowRequestMs !== undefined && duration_ms > opts.slowRequestMs) {
					obs.escalate("warn");
				}

				// maxFieldBytes — trunca strings grandes antes de onEvent/write
				if (opts.maxFieldBytes !== undefined) {
					const current = obs.currentEvent();

					if (current !== undefined) {
						const patch = truncateLargeStrings(current, opts.maxFieldBytes);

						if (patch !== null) obs.enrich(patch);
					}
				}

				// onEvent hook — retorna null pra suprimir; muta via obs.enrich/escalate
				if (opts.onEvent !== undefined) {
					const current = obs.currentEvent();

					if (current !== undefined) {
						const verdict = opts.onEvent(current, c);

						if (verdict === null) obs.suppress();
					}
				}

				// filter-on-write: só suprime se ainda é info (nunca warn/error)
				const current = obs.currentEvent();
				const isInfo = current?.severity === "info";

				if (isInfo && opts.suppressedPaths?.includes(rawPath)) {
					obs.suppress();
				}

				if (isInfo && opts.expectedStatus?.includes(status)) {
					obs.suppress();
				}

				// Hono já capturou a exception antes do next() retornar (default onError).
				// Re-lançamos dentro do scope pro core auto-capturar (severity=error + error payload).
				// Auto-capture sobrepõe suppress — erros sempre observáveis.
				if (c.error !== undefined) throw c.error;
			});
		} catch (err) {
			// caso esperado: c.error re-lançado dentro do scope; core já capturou e store já gravou.
			// caso anormal: store.write falhou ou outra falha do trail. logar pra não engolir silenciosamente.
			if (c.error === undefined || err !== c.error) {
				console.error("[trail] middleware Hono falhou ao gravar evento:", err);
			}
		}
	};
}
