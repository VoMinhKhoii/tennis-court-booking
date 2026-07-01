import { ManualBookingForm } from "@/components/dashboard/manual-booking-form";
import { PageHeader } from "@/components/dashboard/page-header";

export default function ManualBookingPage() {
	return (
		<div>
			<PageHeader
				title="Đặt sân thủ công"
				subtitle="Tạo lượt đặt đã xác nhận cho khách quen. Khung giờ bị khoá ngay lập tức."
			/>
			<ManualBookingForm />
		</div>
	);
}
