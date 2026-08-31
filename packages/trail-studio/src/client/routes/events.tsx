import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { api } from "../api";
import { EventDetail } from "../components/event-detail";
import { EventFilters } from "../components/event-filters";
import { EventTable } from "../components/event-table";
import { useCount } from "../hooks/use-count";
import { useEvents } from "../hooks/use-events";
import { useSchema } from "../hooks/use-schema";

function searchToParams(search: Record<string, string | string[] | undefined>): URLSearchParams {
	const params = new URLSearchParams();

	for (const [key, value] of Object.entries(search)) {
		if (value === undefined || value === "") continue;
		if (Array.isArray(value)) {
			for (const v of value) {
				if (v !== "") params.append(key, v);
			}
		} else {
			params.set(key, value);
		}
	}

	return params;
}

export function EventsPage() {
	const search = useSearch({ from: "/events" });
	const navigate = useNavigate();
	const params = useMemo(() => searchToParams(search), [search]);
	const config = useQuery({ queryKey: ["config"], queryFn: api.config });
	const schema = useSchema();

	const [paused, setPaused] = useState(false);

	useEffect(() => {
		if (config.data) setPaused(!config.data.liveTail);
	}, [config.data]);

	const events = useEvents(params, paused);
	const latestCursor =
		events.data?.events[0] !== undefined
			? `${encodeURIComponent(String(events.data.events[0].timestamp))}_${encodeURIComponent(events.data.events[0].id)}`
			: null;
	const newCount = useCount(params, latestCursor, paused);

	const setSearch = (next: URLSearchParams) => {
		const nextSearch: Record<string, string | string[]> = {};

		for (const key of new Set(next.keys())) {
			const all = next.getAll(key);
			nextSearch[key] = all.length === 1 ? (all[0] as string) : all;
		}

		void navigate({ to: "/events", search: nextSearch });
	};

	const loadMore = () => {
		if (!events.data?.nextCursor) return;
		const next = new URLSearchParams(params);
		next.set("before", events.data.nextCursor);
		setSearch(next);
	};

	const applyNew = () => {
		// recarrega lista do topo: tira cursor e refetcha
		const next = new URLSearchParams(params);
		next.delete("before");
		setSearch(next);
		void events.refetch();
	};

	const total = schema.data?.stats.total ?? 0;
	const newCountValue = newCount.data?.count ?? 0;
	const showBadge = paused && newCountValue > 0;

	return (
		<main>
			<header className="topbar">
				<div>
					<h1>Events</h1>
					<span>{total.toLocaleString()} total</span>
				</div>
				<div className="actions">
					{showBadge ? (
						<button type="button" className="badge-new" onClick={applyNew}>
							{newCountValue} new ↑
						</button>
					) : null}
					<button type="button" onClick={() => setPaused((value) => !value)}>
						{paused ? "Resume" : "Pause"}
					</button>
					<button type="button" onClick={() => void events.refetch()}>
						Refresh
					</button>
				</div>
			</header>

			{schema.isLoading ? <div className="empty">Carregando schema...</div> : null}
			{schema.error ? <div className="empty">{schema.error.message}</div> : null}

			{schema.data ? (
				<>
					<EventFilters columns={schema.data.columns} search={params} onSearchChange={setSearch} />
					{events.isLoading ? <div className="empty">Carregando eventos...</div> : null}
					{events.error ? <div className="empty">{events.error.message}</div> : null}
					{events.data ? (
						<EventTable
							events={events.data.events}
							onLoadMore={loadMore}
							hasMore={events.data.hasMore}
							search={search}
						/>
					) : null}
					<EventDetailRouteAware columns={schema.data.columns} search={search} />
				</>
			) : null}
		</main>
	);
}

// detail drawer monta quando a rota filha `/events/$id` está ativa.
// nesta versão simples, lê o id via Router e renderiza inline.
function EventDetailRouteAware({
	columns,
	search,
}: {
	columns: import("../api").StudioColumn[];
	search: Record<string, string | string[] | undefined>;
}) {
	const navigate = useNavigate();
	const params = useParams({ strict: false });
	const eventId = typeof params.id === "string" ? params.id : null;

	const close = () => void navigate({ to: "/events", search });
	const open = (id: string) => void navigate({ to: "/events/$id", params: { id }, search });

	return <EventDetail eventId={eventId} columns={columns} onClose={close} onOpen={open} />;
}

// Link helper exposto pra outros componentes navegarem mantendo search params
export function useOpenEvent() {
	const navigate = useNavigate();
	const search = useSearch({ from: "/events" });

	return (id: string) => void navigate({ to: "/events/$id", params: { id }, search });
}

export { Link };
