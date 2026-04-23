import type { AnyMiddlewareFunction } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { BaseEvent, Observability } from "./core";
import { truncateLargeStrings } from "./_truncate";

export type TrpcFields = {
	procedure: string;
	duration_ms: number;
	status: "ok" | "error";
	error_code: string;
	error_status: number;
};

export type TrpcMiddlewareOptions<E extends BaseEvent> = {
	slowRequestMs?: number;
	suppressedProcedures?: string[];
	expectedErrorCodes?: string[];
	maxFieldBytes?: number;
	onEvent?: (event: Readonly<E>) => null | void;
};

export function createTrpcMiddleware<E extends BaseEvent & Partial<TrpcFields>>(
	obs: Observability<E>,
	opts: TrpcMiddlewareOptions<E> = {},
): AnyMiddlewareFunction {
	return async ({ next, path }) => {
		// cast: projeto precisa ter "rpc" no E["type"]
		const initial = { type: "rpc", procedure: path } as unknown as Parameters<
			typeof obs.context
		>[0];

		let result: Awaited<ReturnType<typeof next>> | undefined;

		await obs.context(initial, async () => {
			const start = Date.now();

			result = await next();

			const duration_ms = Date.now() - start;

			if (result.ok) {
				obs.enrich({ duration_ms, status: "ok" } as Partial<E>);

				if (opts.slowRequestMs !== undefined && duration_ms > opts.slowRequestMs) {
					obs.escalate("warn");
				}
			} else {
				const err = result.error;
				const status = getHTTPStatusCodeFromError(err);

				obs.enrich({
					duration_ms,
					status: "error",
					error_code: err.code,
					error_status: status,
				} as Partial<E>);

				// 5xx: deixa core auto-capturar severity=error + error payload via re-throw.
				// TRPCError genuinamente-erro (sem cause) ainda trás message/stack pelo toErrorPayload.
				if (status >= 500) throw err;

				// 4xx: severity fica info; retornamos o MiddlewareResult de erro intacto
				// pro tRPC propagar pelo protocolo normal.
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
					const verdict = opts.onEvent(current);

					if (verdict === null) obs.suppress();
				}
			}

			// filter-on-write: só suprime se ainda é info (nunca warn/error)
			const current = obs.currentEvent();
			const isInfo = current?.severity === "info";

			if (isInfo && opts.suppressedProcedures?.includes(path)) {
				obs.suppress();
			}

			if (
				isInfo &&
				opts.expectedErrorCodes !== undefined &&
				current?.error_code !== undefined &&
				opts.expectedErrorCodes.includes(current.error_code)
			) {
				obs.suppress();
			}
		});

		// `result` é definido no caminho ok e no 4xx; no 5xx, o throw acima
		// interrompe antes. Non-null assert é trivialmente seguro pela control flow.
		return result as Awaited<ReturnType<typeof next>>;
	};
}
