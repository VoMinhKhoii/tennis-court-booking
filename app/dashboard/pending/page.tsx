import { HoldsPanel } from "@/components/dashboard/holds-panel";
import { PageHeader } from "@/components/dashboard/page-header";
import { PendingQueue } from "@/components/dashboard/pending-queue";

export default function PendingPage() {
	return (
		<div className="space-y-8">
			<PageHeader title="Chờ duyệt" subtitle="Các lượt đặt cần bạn xử lý." />

			<section>
				<div className="mb-3">
					<h2 className="font-display text-lg font-medium text-ink">Lượt đặt chờ duyệt</h2>
					<p className="text-sm text-ink-soft">
						Cũ nhất trước. Xác nhận để giữ chỗ, hoặc từ chối để giải phóng khung giờ.
					</p>
				</div>
				<PendingQueue />
			</section>

			<section>
				<div className="mb-3">
					<h2 className="font-display text-lg font-medium text-ink">Giữ chỗ tạm</h2>
					<p className="text-sm text-ink-soft">
						Chỉ xem. Giữ chỗ đang hoạt động tạm khoá khung giờ; giữ chỗ hết hạn có thể cần đối soát.
					</p>
				</div>
				<HoldsPanel />
			</section>
		</div>
	);
}
