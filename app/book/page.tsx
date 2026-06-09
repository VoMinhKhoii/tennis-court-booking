import type { Metadata } from "next";
import { BookingForm, type BookingInitial } from "@/components/booking/booking-form";

export const metadata: Metadata = {
	title: "Đặt sân",
	description: "Yêu cầu đặt sân tennis — một buổi hoặc hàng tháng.",
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Build prefill from an owner deep-link (e.g. /book?type=monthly&weekday=2,4,6&start=18:00&dur=4). */
function initialFromParams(sp: SearchParams): BookingInitial {
	const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
	const num = (v: string | string[] | undefined) => {
		const n = Number(str(v));
		return Number.isFinite(n) ? n : undefined;
	};
	// weekday(s) may be a single value or a CSV list (2,4,6).
	const csvWeekdays = (v: string | string[] | undefined): number[] | undefined => {
		const s = str(v);
		if (!s) return undefined;
		const arr = s
			.split(",")
			.map((x) => Number(x.trim()))
			.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
		return arr.length ? arr : undefined;
	};
	const type = str(sp.type);
	return {
		type: type === "monthly" || type === "adhoc" ? type : undefined,
		preferredCourtId: str(sp.court),
		date: str(sp.date),
		month: str(sp.month),
		weekdays: csvWeekdays(sp.weekdays ?? sp.weekday),
		startTime: str(sp.start),
		blockCount: num(sp.dur),
	};
}

export default async function BookPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
	const sp = await searchParams;
	const initial = initialFromParams(sp);
	const lockSlot = (Array.isArray(sp.lock) ? sp.lock[0] : sp.lock) === "1";

	return <BookingForm initial={initial} lockSlot={lockSlot} />;
}
