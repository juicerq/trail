import { useNavigate } from "@tanstack/react-router";
import type { StudioEvent } from "../api";
import { SeverityBadge } from "./severity-badge";

type Props = {
	events: StudioEvent[];
	onLoadMore: () => void;
	hasMore: boolean;
	search: Record<string, string | string[] | undefined>;
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

export function EventTable({ events, onLoadMore, hasMore, search }: Props) {
	const navigate = useNavigate();

	if (events.length === 0) {
		return <div className="empty">Nenhum evento bate com os filtros atuais.</div>;
	}

	const open = (id: string) => void navigate({ to: "/events/$id", params: { id }, search });

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
							<tr key={event.id} onClick={() => open(event.id)}>
								<td>{formatTime(event.timestamp)}</td>
								<td>
									<SeverityBadge severity={event.severity} />
								</td>
								<td>{event.type}</td>
								<td>{displayRoute(event)}</td>
								<td>{event.duration_ms == null ? "" : `${String(event.duration_ms)}ms`}</td>
								<td>{String(error?.code ?? "")}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{hasMore ? (
				<div className="load-more">
					<button type="button" onClick={onLoadMore}>
						Carregar mais
					</button>
				</div>
			) : null}
		</div>
	);
}
