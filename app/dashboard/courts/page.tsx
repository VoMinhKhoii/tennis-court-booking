import { CourtManager } from "@/components/dashboard/court-manager";
import { PageHeader } from "@/components/dashboard/page-header";

export default function CourtsPage() {
	return (
		<div>
			<PageHeader
				title="Sân"
				subtitle="Thêm hoặc sửa sân. Giờ chia theo mốc 30 phút; tắt trạng thái đang mở để ẩn sân khỏi việc đặt."
			/>
			<CourtManager />
		</div>
	);
}
