const labels: Record<string, string> = {
	debug: "Debug",
	info: "Info",
	warn: "Warn",
	error: "Error",
	fatal: "Fatal",
};

export function SeverityBadge({ severity }: { severity: string }) {
	return <span className={`severity severity-${severity}`}>{labels[severity] ?? severity}</span>;
}
