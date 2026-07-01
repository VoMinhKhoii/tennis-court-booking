import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsPanel } from "@/components/dashboard/settings-panel";

export default function SettingsPage() {
	return (
		<div>
			<PageHeader title="Cài đặt" subtitle="Giá theo giờ và mã QR thanh toán hiển thị cho khách." />
			<SettingsPanel />
		</div>
	);
}
