/** Grid legend — explains cell states with swatch + label (not color alone). */
export function GridLegend() {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-soft">
			<span className="inline-flex items-center gap-1.5">
				<span className="h-3.5 w-3.5 rounded-[4px] border border-court-300 bg-paper-raised" />
				Trống
			</span>
			<span className="inline-flex items-center gap-1.5">
				<span className="net-hatch h-3.5 w-3.5 rounded-[4px] border border-booked-line bg-booked" />
				Đã đặt
			</span>
			<span className="inline-flex items-center gap-1.5">
				<span className="h-3.5 w-3.5 rounded-[4px] bg-accent-focus" />
				Bạn chọn
			</span>
		</div>
	);
}
