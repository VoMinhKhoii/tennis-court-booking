import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";
import "./globals.css";
import { SiteBackground } from "@/components/site-background";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

// Two typefaces, Anthropic-style: an editorial serif for display headlines
// ("Copernicus" substitute) over a humanist sans for everything else. Inter
// also carries the numerals (times, amounts, references) via tabular-nums, so
// no separate monospace face is needed. Both cover Vietnamese diacritics.
const ebGaramond = EB_Garamond({
	variable: "--font-eb-garamond",
	subsets: ["latin", "vietnamese"],
	weight: ["400", "500"],
});

const inter = Inter({
	variable: "--font-inter",
	subsets: ["latin", "vietnamese"],
	weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
	title: {
		default: "Đặt sân tennis",
		template: "%s | Đặt sân tennis",
	},
	description: "Xem lịch trống theo thời gian thực và đặt sân tennis của bạn.",
	applicationName: "Đặt sân tennis",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="vi" className={cn("h-full antialiased", ebGaramond.variable, inter.variable)}>
			<body className="flex min-h-full flex-col font-sans">
				<SiteBackground />
				<Providers>{children}</Providers>
				<Toaster />
				<Analytics />
			</body>
		</html>
	);
}
