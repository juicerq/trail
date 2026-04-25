import { type AnyMiddleware, ORPCError } from "@orpc/server";
import type { BaseEvent, Observability } from "./core";
import { truncateLargeStrings } from "./_truncate";
import { measureInputSize, redactInput, type RedactInputOptions } from "./redaction";

export type { RedactInputOptions };

export type OrpcFields = {
	procedure: string;
	duration_ms: number;
	status: "ok" | "error";
	error_code: string;
	error_status: number;
	input: unknown;
	input_size: number;
};

export type OrpcMiddlewareOptions<E extends BaseEvent> = {
	slowRequestMs?: number;
	suppressedProcedures?: string[];
	expectedErrorCodes?: string[];
	maxFieldBytes?: number;
	captureInput?: boolean | RedactInputOptions;
	onEvent?: (event: Readonly<E>) => null | void;
};

export function createOrpcMiddleware<E extends BaseEvent & Partial<OrpcFields>>(
	obs: Observability<E>,
	opts: OrpcMiddlewareOptions<E> = {},
): AnyMiddleware {
	return async ({ next, path }, input) => {
		const procedure = path.join(".");

		// cast: projeto precisa ter "rpc" no E["type"]
		const initial = { type: "rpc", procedure } as unknown as Parameters<typeof obs.context>[0];

		let caught: unknown;
		let result: Awaited<ReturnType<typeof next>> | undefined;

		await obs.context(initial, async () => {
			const start = Date.now();

			if (opts.captureInput !== undefined && opts.captureInput !== false) {
				const redactionOptions = opts.captureInput === true ? undefined : opts.captureInput;
				const input_size = measureInputSize(input);

				obs.enrich({
					input: redactInput(input, redactionOptions),
					...(input_size === undefined ? {} : { input_size }),
				} as Partial<E>);
			}

			try {
				result = await next();

				const duration_ms = Date.now() - start;

				obs.enrich({ duration_ms, status: "ok" } as Partial<E>);

				if (opts.slowRequestMs !== undefined && duration_ms > opts.slowRequestMs) {
					obs.escalate("warn");
				}
			} catch (err) {
				const duration_ms = Date.now() - start;

				if (err instanceof ORPCError) {
					obs.enrich({
						duration_ms,
						status: "error",
						error_code: err.code,
						error_status: err.status,
					} as Partial<E>);

					// 5xx: deixa core auto-capturar severity=error + error payload via re-throw
					if (err.status >= 500) throw err;

					// 4xx: severity fica info; guardamos pra re-lançar depois do scope
					caught = err;
				} else {
					// plain Error: core auto-captura (severity=error, error payload, re-throw)
					throw err;
				}
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

			if (isInfo && opts.suppressedProcedures?.includes(procedure)) {
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

		if (caught !== undefined) throw caught;

		// `result` é definido no sucesso; no caminho 4xx, `caught` já lançou acima —
		// esse non-null assert é trivialmente seguro pela control flow.
		return result as Awaited<ReturnType<typeof next>>;
	};
}
