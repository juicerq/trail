import type { StudioEvent } from "../api";
import { SeverityBadge } from "./severity-badge";

type Props = {
	events: StudioEvent[];
	onOpen: (id: string) => void;
	onLoadMore: () => void;
	hasMore: boolean;
};

function formatTime(ms: number) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "short",
		timeStyle: "medium",
	}).format(new Date(ms));
}

function displayRoute(event: StudioEvent): string {
	const extra = event.extra as Record<string, unknown> | null;
	return String(event.procedure ?? extra?.path ?? extra?.procedure ?? "");
}

export function EventTable({ events, onOpen, onLoadMore, hasMore }: Props) {
	if (events.length === 0) {
		return <div className="empty">No events match the current filters.</div>;
	}

	return (
		<div className="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Timestamp</th>
						<th>Severity</th>
						<th>Type</th>
						<th>Procedure / path</th>
						<th>Duration</th>
						<th>Error code</th>
					</tr>
				</thead>
				<tbody>
					{events.map((event) => {
						const error = event.error as Record<string, unknown> | null;

						return (
							<tr key={event.id} onClick={() => onOpen(event.id)}>
								<td>{formatTime(event.timestamp)}</td>
								<td>
									<SeverityBadge severity={event.severity} />
								</td>
								<td>{event.type}</td>
								<td>{displayRoute(event)}</td>
								<td>{event.duration_ms == null ? "" : `${event.duration_ms}ms`}</td>
								<td>{String(error?.code ?? "")}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{hasMore ? (
				<div className="load-more">
					<button type="button" onClick={onLoadMore}>
						Load more
					</button>
				</div>
			) : null}
		</div>
	);
}
