"use client";

import { CalendarCheck, Clock, Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { formatAge } from "@/lib/dashboard/format";
import { type ActivityKind, recentActivity } from "@/lib/dashboard/metrics";
import {
	useConfirmedBookings,
	useCourts,
	useHeldBookings,
	usePendingBookings,
} from "@/lib/queries/dashboard";

const KIND_ICON = {
	confirmed: CalendarCheck,
	pending: Inbox,
	held: Clock,
} as const;

const KIND_STYLE: Record<ActivityKind, string> = {
	confirmed: "bg-court-100 text-court-800",
	pending: "bg-signal-amber-soft text-signal-amber",
	held: "bg-chalk text-chalk-ink",
};

/** Recent-activity feed merged from the confirmed / pending / held queues. */
export function ActivityFeed() {
	const pending = usePendingBookings();
	const held = useHeldBookings();
	const confirmed = useConfirmedBookings({});
	const courts = useCourts();

	const items = useMemo(() => {
		const nameById = new Map((courts.data ?? []).map((c) => [c.id, c.name]));
		return recentActivity(pending.data ?? [], held.data ?? [], confirmed.data ?? [], nameById);
	}, [pending.data, held.data, confirmed.data, courts.data]);

	return (
		<section className="rounded-2xl border border-line bg-card p-4 shadow-court sm:p-6">
			<div className="mb-4 flex items-center justify-between">
				<h2 className="font-display text-lg font-medium text-ink">Hoạt động gần đây</h2>
				<Link
					href="/dashboard/confirmed"
					className="text-xs font-medium text-court-700 hover:underline"
				>
					Xem tất cả →
				</Link>
			</div>

			{items.length === 0 ? (
				<p className="py-8 text-center text-sm text-ink-faint">
					Hoạt động sẽ hiển thị ở đây khi có lượt đặt.
				</p>
			) : (
				<ul className="space-y-3">
					{items.map((it) => {
						const Icon = KIND_ICON[it.kind];
						return (
							<li key={it.id} className="flex items-center gap-3">
								<span
									className={`grid size-8 shrink-0 place-items-center rounded-full ${KIND_STYLE[it.kind]}`}
								>
									<Icon className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium text-ink">{it.title}</div>
									<div className="text-xs text-ink-faint">{it.court ?? "—"}</div>
								</div>
								<span className="shrink-0 text-xs tabular-nums text-ink-faint">
									{formatAge(it.at)}
								</span>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
