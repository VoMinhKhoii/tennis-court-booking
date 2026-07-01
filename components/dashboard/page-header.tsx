/** Shared dashboard page heading: serif title, muted subtitle, optional action. */
export function PageHeader({
	title,
	subtitle,
	action,
}: {
	title: string;
	subtitle?: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="mb-6 flex items-end justify-between gap-4">
			<div>
				<h1 className="font-display text-2xl font-normal tracking-tight text-ink sm:text-3xl">
					{title}
				</h1>
				{subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
			</div>
			{action && <div className="shrink-0">{action}</div>}
		</div>
	);
}
