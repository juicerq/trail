import type { StudioColumn } from "../api";
import { useTrace } from "../hooks/use-trace";
import { SeverityBadge } from "./severity-badge";
import { TraceView } from "./trace-view";

type Props = {
	eventId: string | null;
	columns: StudioColumn[];
	onClose: () => void;
	onOpen: (id: string) => void;
};

const baseOrder = [
	"id",
	"timestamp",
	"severity",
	"type",
	"service",
	"hostname",
	"parent_id",
	"error",
];

function JsonBlock({ value }: { value: unknown }) {
	return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function Field({ name, value }: { name: string; value: unknown }) {
	return (
		<div className="kv">
			<span>{name}</span>
			{typeof value === "object" && value !== null ? (
				<JsonBlock value={value} />
			) : (
				<code>{String(value ?? "")}</code>
			)}
		</div>
	);
}

export function EventDetail({ eventId, columns, onClose, onOpen }: Props) {
	const trace = useTrace(eventId);

	if (eventId === null) return null;

	const event = trace.data?.event;
	const customColumns = columns.filter((column) => !column.base && column.name !== "extra");

	return (
		<aside className="drawer">
			<div className="drawer-header">
				<div>
					<h2>Event</h2>
					{event ? <SeverityBadge severity={event.severity} /> : null}
				</div>
				<button type="button" onClick={onClose}>
					Close
				</button>
			</div>
			{trace.isLoading ? <div className="empty">Carregando evento...</div> : null}
			{trace.error ? <div className="empty">{trace.error.message}</div> : null}
			{event ? (
				<div className="drawer-body">
					<section className="detail-section">
						<h3>Campos base</h3>
						{baseOrder.map((name) => (
							<Field
								key={name}
								name={name}
								value={name === "timestamp" ? new Date(event.timestamp).toISOString() : event[name]}
							/>
						))}
					</section>
					{customColumns.length > 0 ? (
						<section className="detail-section">
							<h3>Campos declarados</h3>
							{customColumns.map((column) => (
								<Field key={column.name} name={column.name} value={event[column.name]} />
							))}
						</section>
					) : null}
					<section className="detail-section">
						<h3>Extra</h3>
						<JsonBlock value={event.extra ?? {}} />
					</section>
					<TraceView
						ancestors={trace.data?.ancestors ?? []}
						children={trace.data?.children ?? []}
						onOpen={onOpen}
					/>
				</div>
			) : null}
		</aside>
	);
}
