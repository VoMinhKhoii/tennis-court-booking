import { ConfirmedView } from "@/components/dashboard/confirmed-view";
import { PageHeader } from "@/components/dashboard/page-header";

export default function ConfirmedPage() {
	return (
		<div>
			<PageHeader
				title="Lượt đặt đã xác nhận"
				subtitle="Lọc theo sân, tháng hoặc tên khách hàng."
			/>
			<ConfirmedView />
		</div>
	);
}
