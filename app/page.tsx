import { CalendarClock, MessageCircle, Zap } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURES = [
	{
		icon: CalendarClock,
		title: "Lịch trực tiếp",
		desc: "Khung giờ trống cập nhật theo thời gian thực, không cần gọi hỏi.",
	},
	{
		icon: Zap,
		title: "Giữ chỗ tức thì",
		desc: "Chọn khung giờ, điền tên & Zalo — chỗ được giữ ngay lập tức.",
	},
	{
		icon: MessageCircle,
		title: "Xác nhận qua Zalo",
		desc: "Chuyển khoản theo mã, gửi ảnh cho chủ sân, nhận xác nhận.",
	},
];

export default function Home() {
	return (
		<main className="relative flex-1">
			<div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
				<p className="animate-fade-up font-mono text-xs uppercase tracking-[0.3em] text-ink-faint">
					Sân tennis · Đặt lịch trực tuyến
				</p>
				<h1 className="mt-4 animate-fade-up font-display text-5xl font-normal leading-[1.05] tracking-tight text-ink [animation-delay:80ms] sm:text-7xl">
					Giữ sân
					<br />
					<span className="text-ink">trong vài giây.</span>
				</h1>
				<p className="mt-5 max-w-md animate-fade-up text-lg leading-relaxed text-ink-soft [animation-delay:160ms]">
					Xem lịch trống theo thời gian thực, chọn khung giờ và đặt sân — một buổi lẻ hoặc cố định
					hằng tháng.
				</p>

				<div className="mt-8 flex animate-fade-up flex-col gap-3 [animation-delay:240ms] sm:flex-row">
					<Link
						href="/availability"
						className={cn(buttonVariants({ size: "lg" }), "h-12 px-7 text-base")}
					>
						Xem lịch trống
					</Link>
					<Link
						href="/book"
						className={cn(
							buttonVariants({ variant: "outline", size: "lg" }),
							"h-12 px-7 text-base",
						)}
					>
						Đặt sân ngay
					</Link>
				</div>

				<div className="mt-16 grid animate-fade-up gap-4 [animation-delay:320ms] sm:grid-cols-3">
					{FEATURES.map((f) => (
						<div key={f.title} className="rounded-xl bg-accent p-8">
							<f.icon className="size-5 text-brand-green-deep" />
							<h2 className="mt-4 font-display text-xl font-medium tracking-tight text-ink">
								{f.title}
							</h2>
							<p className="mt-2 text-sm leading-relaxed text-ink-soft">{f.desc}</p>
						</div>
					))}
				</div>

				{/* Deep-green callout band with a light pill — white-on-green CTA moment. */}
				<div className="mt-16 flex animate-fade-up flex-col items-start gap-6 rounded-xl bg-brand-green p-10 text-on-dark [animation-delay:400ms] sm:flex-row sm:items-center sm:justify-between sm:p-12">
					<div>
						<h2 className="font-display text-3xl font-normal leading-tight tracking-tight">
							Sẵn sàng ra sân?
						</h2>
						<p className="mt-2 max-w-md text-base leading-relaxed text-on-dark/80">
							Chọn khung giờ trống và giữ chỗ ngay — chỉ mất vài giây.
						</p>
					</div>
					<Link
						href="/availability"
						className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white px-7 text-base font-medium text-primary transition-colors hover:bg-court-50"
					>
						Xem lịch trống
					</Link>
				</div>
			</div>
		</main>
	);
}
