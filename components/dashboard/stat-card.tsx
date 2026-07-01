import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One KPI tile: label + big value + optional trend chip. The delta is hidden
 * when null (no prior period to compare against — e.g. an empty demo DB).
 */
export function StatCard({
	label,
	value,
	delta,
	hint,
	loading,
}: {
	label: string;
	value: string;
	delta: number | null;
	hint?: string;
	loading?: boolean;
}) {
	const up = delta !== null && delta >= 0;
	return (
		<div className="rounded-xl border border-line bg-card p-4 shadow-court sm:p-5">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-ink-soft">{label}</span>
				{delta !== null && (
					<span
						className={cn(
							"inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
							up ? "text-success" : "text-signal-red",
						)}
					>
						{up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
						{up ? "+" : ""}
						{delta}%
					</span>
				)}
			</div>
			<div className="mt-2 font-display text-2xl font-medium tracking-tight tabular-nums text-ink sm:text-3xl">
				{loading ? <span className="text-ink-faint">—</span> : value}
			</div>
			{hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
		</div>
	);
}
