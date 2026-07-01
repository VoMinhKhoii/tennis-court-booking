"use client";

import type { LucideIcon } from "lucide-react";
import {
	CalendarCheck,
	CalendarClock,
	CalendarPlus,
	Inbox,
	LayoutDashboard,
	LayoutGrid,
	LogOut,
	Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { usePendingBookings } from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
	{
		title: "Tổng quan",
		items: [{ href: "/dashboard", label: "Bảng điều khiển", icon: LayoutDashboard }],
	},
	{
		title: "Đặt sân",
		items: [
			{ href: "/dashboard/pending", label: "Chờ duyệt", icon: Inbox },
			{ href: "/dashboard/confirmed", label: "Đã xác nhận", icon: CalendarCheck },
			{ href: "/dashboard/manual", label: "Đặt sân thủ công", icon: CalendarPlus },
		],
	},
	{
		title: "Quản lý",
		items: [
			{ href: "/dashboard/courts", label: "Sân", icon: LayoutGrid },
			{ href: "/dashboard/settings", label: "Cài đặt", icon: Settings },
		],
	},
];

/**
 * Owner-console sidebar: brand mark, grouped route-aware nav, sign-out. Vertical
 * rail on lg+, collapses to a horizontal scrollable bar on smaller screens
 * (group labels hide there). Auth gating stays in the server layout.
 */
export function DashboardSidebar() {
	const pathname = usePathname();
	const pending = usePendingBookings();
	const pendingCount = pending.data?.length ?? 0;

	return (
		<aside className="flex items-center gap-3 border-b border-line bg-paper/80 px-4 py-3 backdrop-blur lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
			<div className="flex shrink-0 items-center gap-2.5 lg:px-2 lg:pb-4">
				<span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
					<CalendarClock className="size-5" />
				</span>
				<div className="leading-tight">
					<div className="font-display text-base font-medium tracking-tight text-ink">
						Tennis Club
					</div>
					<div className="hidden text-xs text-ink-faint sm:block">Trang quản trị</div>
				</div>
			</div>

			<nav className="flex flex-1 gap-1 overflow-x-auto no-scrollbar lg:flex-none lg:flex-col lg:overflow-visible">
				{NAV_GROUPS.map((group) => (
					<div key={group.title} className="contents lg:block">
						<div className="hidden px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase lg:block">
							{group.title}
						</div>
						{group.items.map((item) => {
							const active = pathname === item.href;
							const badge = item.href === "/dashboard/pending" && pendingCount > 0;
							return (
								<Link
									key={item.href}
									href={item.href}
									aria-current={active ? "page" : undefined}
									className={cn(
										"flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
										active
											? "bg-secondary text-ink"
											: "text-ink-soft hover:bg-secondary/60 hover:text-ink",
									)}
								>
									<item.icon
										className={cn(
											"size-4 shrink-0",
											active ? "text-brand-green-deep" : "text-ink-faint",
										)}
									/>
									<span>{item.label}</span>
									{badge && (
										<span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
											{pendingCount}
										</span>
									)}
								</Link>
							);
						})}
					</div>
				))}
			</nav>

			<form action={logout} className="shrink-0 lg:mt-auto lg:border-t lg:border-line lg:pt-3">
				<button
					type="submit"
					className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-secondary/60 hover:text-ink"
				>
					<LogOut className="size-4 shrink-0 text-ink-faint" />
					<span className="hidden lg:inline">Đăng xuất</span>
				</button>
			</form>
		</aside>
	);
}
