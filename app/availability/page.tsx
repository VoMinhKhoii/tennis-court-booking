import type { Metadata } from "next";
import Link from "next/link";
import { AvailabilityView } from "@/components/availability/availability-view";

export const metadata: Metadata = {
	title: "Lịch trống",
	description: "Lịch sân tennis trống theo thời gian thực — tuần này và các tuần tới.",
};

export default function AvailabilityPage() {
	return (
		<main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
			<header className="mb-5">
				<Link
					href="/"
					className="text-sm font-medium text-court-700 transition-colors hover:text-court-900"
				>
					← Trang chủ
				</Link>
				<h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink">
					Lịch trống
				</h1>
				<p className="mt-1 text-sm text-ink-soft">
					Chạm khung giờ bắt đầu rồi khung kết thúc để chọn, sau đó đặt sân.
				</p>
			</header>
			<AvailabilityView />
		</main>
	);
}
