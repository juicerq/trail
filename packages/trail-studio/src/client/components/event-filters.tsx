import { SEVERITIES } from "../../_types";
import type { StudioColumn } from "../api";
import { useDistinct } from "../hooks/use-distinct";

type Props = {
	columns: StudioColumn[];
	search: URLSearchParams;
	onSearchChange: (next: URLSearchParams) => void;
};

const padDatePart = (n: number) => String(n).padStart(2, "0");

function setParam(search: URLSearchParams, key: string, value: string) {
	const next = new URLSearchParams(search);
	next.delete("before");
	next.delete("after");

	if (value === "") next.delete(key);
	else next.set(key, value);

	return next;
}

function msToDateInput(value: string | null): string {
	if (value === null || value === "") return "";

	const ms = Number(value);
	if (!Number.isFinite(ms)) return "";

	const date = new Date(ms);

	return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function dateInputToMs(value: string, boundary: "start" | "end"): string {
	if (value === "") return "";

	const [year, month, day] = value.split("-").map(Number);

	if (year === undefined || month === undefined || day === undefined) return "";

	const date =
		boundary === "start"
			? new Date(year, month - 1, day, 0, 0, 0, 0)
			: new Date(year, month - 1, day, 23, 59, 59, 999);
	const ms = date.getTime();
	if (!Number.isFinite(ms)) return "";

	return String(ms);
}

function TypeFilter(props: Props) {
	const distinct = useDistinct("type", true);
	const current = props.search.get("type") ?? "";
	const values = distinct.data?.values.map(String) ?? [];

	return (
		<label className="field">
			<span>Type</span>
			<select
				value={current}
				onChange={(event) =>
					props.onSearchChange(setParam(props.search, "type", event.target.value))
				}
			>
				<option value="">Todos</option>
				{values.map((value) => (
					<option key={value} value={value}>
						{value}
					</option>
				))}
			</select>
		</label>
	);
}

function DynamicFilter({ column, search, onSearchChange }: Props & { column: StudioColumn }) {
	const numeric = /INT|REAL|NUM/i.test(column.type);

	if (numeric) {
		return (
			<div className="field field-pair">
				<span>{column.name}</span>
				<input
					type="number"
					placeholder="min"
					value={search.get(`${column.name}.min`) ?? ""}
					onChange={(event) =>
						onSearchChange(setParam(search, `${column.name}.min`, event.target.value))
					}
				/>
				<input
					type="number"
					placeholder="max"
					value={search.get(`${column.name}.max`) ?? ""}
					onChange={(event) =>
						onSearchChange(setParam(search, `${column.name}.max`, event.target.value))
					}
				/>
			</div>
		);
	}

	return (
		<label className="field">
			<span>{column.name}</span>
			<input
				value={search.get(`${column.name}~`) ?? ""}
				placeholder="contém"
				onChange={(event) =>
					onSearchChange(setParam(search, `${column.name}~`, event.target.value))
				}
			/>
		</label>
	);
}

export function EventFilters(props: Props) {
	const selectedSeverities = new Set(props.search.getAll("severity"));
	const customColumns = props.columns.filter(
		(column) => !column.base && column.name !== "extra" && column.name !== "error",
	);

	const toggleSeverity = (severity: string) => {
		const next = new URLSearchParams(props.search);
		next.delete("before");
		next.delete("after");
		next.delete("severity");

		const values = new Set(selectedSeverities);
		if (values.has(severity)) values.delete(severity);
		else values.add(severity);

		for (const value of values) next.append("severity", value);
		props.onSearchChange(next);
	};

	return (
		<section className="filters">
			<div className="field">
				<span>Severity</span>
				<div className="segmented">
					{SEVERITIES.map((severity) => (
						<button
							key={severity}
							className={selectedSeverities.has(severity) ? "active" : ""}
							type="button"
							onClick={() => toggleSeverity(severity)}
						>
							{severity}
						</button>
					))}
				</div>
			</div>
			<TypeFilter {...props} />
			<label className="field">
				<span>From</span>
				<input
					type="date"
					value={msToDateInput(props.search.get("from"))}
					onChange={(event) => {
						const value = dateInputToMs(event.target.value, "start");
						props.onSearchChange(setParam(props.search, "from", value));
					}}
				/>
			</label>
			<label className="field">
				<span>To</span>
				<input
					type="date"
					value={msToDateInput(props.search.get("to"))}
					onChange={(event) => {
						const value = dateInputToMs(event.target.value, "end");
						props.onSearchChange(setParam(props.search, "to", value));
					}}
				/>
			</label>
			{customColumns.map((column) => (
				<DynamicFilter key={column.name} {...props} column={column} />
			))}
		</section>
	);
}
