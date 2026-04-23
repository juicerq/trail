import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { EventDetail } from "./components/event-detail";
import { EventFilters } from "./components/event-filters";
import { EventTable } from "./components/event-table";
import { useEvents } from "./hooks/use-events";
import { useSchema } from "./hooks/use-schema";

function currentEventId(): string | null {
	const match = /^\/events\/([^/]+)$/.exec(window.location.pathname);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function navigate(pathname: string, search: URLSearchParams) {
	window.history.pushState(null, "", `${pathname}${search.toString() ? `?${search}` : ""}`);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
	const [locationVersion, setLocationVersion] = useState(0);
	const [paused, setPaused] = useState(false);
	const config = useQuery({ queryKey: ["config"], queryFn: api.config });
	const schema = useSchema();
	const search = useMemo(() => new URLSearchParams(window.location.search), [locationVersion]);
	const selectedEventId = currentEventId();
	const events = useEvents(search, paused);

	useEffect(() => {
		const onPopState = () => setLocationVersion((version) => version + 1);
		window.addEventListener("popstate", onPopState);

		if (window.location.pathname === "/") {
			navigate("/events", search);
		}

		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	useEffect(() => {
		if (config.data) setPaused(!config.data.liveTail);
	}, [config.data]);

	const setSearch = (next: URLSearchParams) => navigate("/events", next);
	const openEvent = (id: string) => navigate(`/events/${encodeURIComponent(id)}`, search);
	const closeEvent = () => navigate("/events", search);
	const loadMore = () => {
		if (!events.data?.nextCursor) return;
		const next = new URLSearchParams(search);
		next.set("before", events.data.nextCursor);
		navigate("/events", next);
	};

	const total = schema.data?.stats.total ?? 0;

	return (
		<main>
			<header className="topbar">
				<div>
					<h1>Events</h1>
					<span>{total.toLocaleString()} total</span>
				</div>
				<div className="actions">
					<button type="button" onClick={() => setPaused((value) => !value)}>
						{paused ? "Resume" : "Pause"}
					</button>
					<button type="button" onClick={() => void events.refetch()}>
						Refresh
					</button>
				</div>
			</header>

			{schema.isLoading ? <div className="empty">Loading schema...</div> : null}
			{schema.error ? <div className="empty">{schema.error.message}</div> : null}

			{schema.data ? (
				<>
					<EventFilters columns={schema.data.columns} search={search} onSearchChange={setSearch} />
					{events.isLoading ? <div className="empty">Loading events...</div> : null}
					{events.error ? <div className="empty">{events.error.message}</div> : null}
					{events.data ? (
						<EventTable
							events={events.data.events}
							onOpen={openEvent}
							onLoadMore={loadMore}
							hasMore={events.data.hasMore}
						/>
					) : null}
					<EventDetail
						eventId={selectedEventId}
						columns={schema.data.columns}
						onClose={closeEvent}
						onOpen={openEvent}
					/>
				</>
			) : null}
		</main>
	);
}
