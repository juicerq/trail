import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { EventsPage } from "./routes/events";

// search params como Record livre — espelha 1:1 a URLSearchParams que o server consome.
// validateSearch normaliza chaves duplicadas (ex: severity=warn&severity=error) em arrays.
type EventsSearch = Record<string, string | string[] | undefined>;

const validateEventsSearch = (raw: Record<string, unknown>): EventsSearch => {
	const result: EventsSearch = {};

	for (const [key, value] of Object.entries(raw)) {
		if (value === undefined || value === null || value === "") continue;
		if (Array.isArray(value)) result[key] = value.map(String);
		else result[key] = String(value);
	}

	return result;
};

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: () => {
		throw redirect({ to: "/events" });
	},
});

const eventsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/events",
	component: EventsPage,
	validateSearch: validateEventsSearch,
});

const eventDetailRoute = createRoute({
	getParentRoute: () => eventsRoute,
	path: "$id",
	validateSearch: validateEventsSearch,
});

const routeTree = rootRoute.addChildren([indexRoute, eventsRoute.addChildren([eventDetailRoute])]);

// preserva forma URL-natural (severity=warn&severity=error) em vez do JSON.stringify default
function parseSearch(str: string): Record<string, string | string[]> {
	const search = new URLSearchParams(str.startsWith("?") ? str.slice(1) : str);
	const result: Record<string, string | string[]> = {};

	for (const key of new Set(search.keys())) {
		const all = search.getAll(key);
		result[key] = all.length === 1 ? (all[0] as string) : all;
	}

	return result;
}

function stringifySearch(search: Record<string, unknown>): string {
	const params = new URLSearchParams();

	for (const [key, value] of Object.entries(search)) {
		if (value === undefined || value === null || value === "") continue;

		if (Array.isArray(value)) {
			for (const v of value) {
				if (v === undefined || v === null || v === "") continue;
				params.append(key, String(v));
			}
		} else {
			params.set(key, String(value));
		}
	}

	const str = params.toString();
	return str ? `?${str}` : "";
}

export const router = createRouter({
	routeTree,
	parseSearch,
	stringifySearch,
	defaultPreload: false,
});

export { eventsRoute, eventDetailRoute };

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
