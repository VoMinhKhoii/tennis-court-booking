import type { ReactNode } from "react";

export type Tone = "free" | "taken" | "pending" | "confirmed" | "rejected";

const tones: Record<Tone, { wrap: string; dot: string }> = {
	free: { wrap: "bg-court-50 text-ink-soft", dot: "bg-success" },
	taken: { wrap: "bg-chalk text-chalk-ink", dot: "bg-chalk-ink" },
	pending: { wrap: "bg-signal-amber-soft text-signal-amber", dot: "bg-signal-amber" },
	confirmed: { wrap: "bg-court-100 text-ink", dot: "bg-success" },
	rejected: { wrap: "bg-signal-red-soft text-signal-red", dot: "bg-signal-red" },
};

/** Small status chip. Color is never the only cue — always paired with a label. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
	const t = tones[tone];
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.wrap}`}
		>
			<span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
			{children}
		</span>
	);
}
