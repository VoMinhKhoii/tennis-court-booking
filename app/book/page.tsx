import type { Metadata } from "next";
import { BookingForm, type BookingInitial } from "@/components/booking/booking-form";

export const metadata: Metadata = {
	title: "Đặt sân",
	description: "Yêu cầu đặt sân tennis — đặt lẻ một buổi.",
};

type SearchParams = Record<string, string | string[] | undefined>;

/** Build a one-off prefill from a grid selection (e.g. /book?date=…&start=18:00&dur=4&court=…). */
function initialFromParams(sp: SearchParams): BookingInitial {
	const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
	const num = (v: string | string[] | undefined) => {
		const n = Number(str(v));
		return Number.isFinite(n) ? n : undefined;
	};
	return {
		preferredCourtId: str(sp.court),
		date: str(sp.date),
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
