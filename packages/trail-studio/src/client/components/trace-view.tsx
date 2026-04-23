import type { StudioEvent } from "../api";
import { SeverityBadge } from "./severity-badge";

type Props = {
	ancestors: StudioEvent[];
	children: StudioEvent[];
	onOpen: (id: string) => void;
};

export function TraceView({ ancestors, children, onOpen }: Props) {
	return (
		<section className="detail-section">
			<h3>Trace</h3>
			<div className="trace-list">
				{ancestors.length === 0 ? <span className="muted">No ancestors</span> : null}
				{ancestors.map((event) => (
					<button key={event.id} type="button" onClick={() => onOpen(event.id)}>
						<SeverityBadge severity={event.severity} />
						<span>{event.type}</span>
						<code>{event.id}</code>
					</button>
				))}
			</div>
			<div className="children">
				<h4>Children</h4>
				{children.length === 0 ? <span className="muted">No direct children</span> : null}
				{children.map((event) => (
					<button key={event.id} type="button" onClick={() => onOpen(event.id)}>
						<SeverityBadge severity={event.severity} />
						<span>{event.type}</span>
						<code>{event.id}</code>
					</button>
				))}
			</div>
		</section>
	);
}
