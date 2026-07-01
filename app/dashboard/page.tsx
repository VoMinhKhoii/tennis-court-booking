import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { CourtStatusPanel } from "@/components/dashboard/court-status-panel";
import { DashboardStats } from "@/components/dashboard/dashboard-stats";
import { PageHeader } from "@/components/dashboard/page-header";
import { RevenueChart } from "@/components/dashboard/revenue-chart";

export default function DashboardPage() {
	return (
		<div className="space-y-6">
			<PageHeader title="Bảng điều khiển" subtitle="Chào mừng trở lại — tổng quan sân của bạn." />

			<DashboardStats />

			<RevenueChart />

			<div className="grid gap-6 lg:grid-cols-2">
				<CourtStatusPanel />
				<ActivityFeed />
			</div>
		</div>
	);
}
