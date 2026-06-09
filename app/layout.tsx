import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Be_Vietnam_Pro, Geist_Mono, Saira } from "next/font/google";
import "./globals.css";
import { SiteBackground } from "@/components/site-background";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

// Display: athletic grotesque for headings + scoreboard numerals.
const saira = Saira({
	variable: "--font-saira",
	subsets: ["latin", "vietnamese"],
	weight: ["500", "600", "700", "800"],
});

// Body: purpose-built for Vietnamese, refined and highly legible.
const beVietnam = Be_Vietnam_Pro({
	variable: "--font-be-vietnam",
	subsets: ["latin", "vietnamese"],
	weight: ["400", "500", "600", "700"],
});

// Tabular numerals for the time axis, amounts and references.
const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
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
		<html
			lang="vi"
			className={cn("h-full antialiased", saira.variable, beVietnam.variable, geistMono.variable)}
		>
			<body className="flex min-h-full flex-col font-sans">
				<SiteBackground />
				<Providers>{children}</Providers>
				<Toaster />
				<Analytics />
			</body>
		</html>
	);
}
