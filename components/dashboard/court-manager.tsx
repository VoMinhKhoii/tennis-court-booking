"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { createCourt, updateCourt } from "@/lib/actions/owner";
import { type CourtInput, courtInputSchema } from "@/lib/booking/schemas";
import { useCourts } from "@/lib/queries/dashboard";
import type { CourtRow } from "@/lib/queries/types";

const inputClass =
	"w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

/** HH:MM:SS -> HH:MM for <input type="time">. */
function toHm(t: string): string {
	return t.slice(0, 5);
}

export function CourtManager() {
	const queryClient = useQueryClient();
	const { data: courts, isLoading } = useCourts();
	const [editing, setEditing] = useState<CourtRow | "new" | null>(null);

	function refresh() {
		queryClient.invalidateQueries({ queryKey: ["courts"] });
		setEditing(null);
	}

	if (isLoading) {
		return <p className="text-sm text-zinc-500">Loading…</p>;
	}

	return (
		<div className="space-y-4">
			<ul className="space-y-2">
				{(courts ?? []).map((c) => (
					<li
						key={c.id}
						className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
					>
						<div>
							<div className="font-medium">
								{c.name}
								{!c.is_active && (
									<span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
										inactive
									</span>
								)}
							</div>
							<div className="text-sm text-zinc-600 dark:text-zinc-400">
								{toHm(c.open_time)}–{toHm(c.close_time)}
							</div>
						</div>
						<button
							type="button"
							onClick={() => setEditing(c)}
							className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
						>
							Edit
						</button>
					</li>
				))}
			</ul>

			{editing ? (
				<CourtForm
					key={editing === "new" ? "new" : editing.id}
					court={editing === "new" ? null : editing}
					onDone={refresh}
					onCancel={() => setEditing(null)}
				/>
			) : (
				<button
					type="button"
					onClick={() => setEditing("new")}
					className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
				>
					Add court
				</button>
			)}
		</div>
	);
}

function CourtForm({
	court,
	onDone,
	onCancel,
}: {
	court: CourtRow | null;
	onDone: () => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(court?.name ?? "");
	const [openTime, setOpenTime] = useState(court ? toHm(court.open_time) : "06:00");
	const [closeTime, setCloseTime] = useState(court ? toHm(court.close_time) : "21:00");
	const [isActive, setIsActive] = useState(court?.is_active ?? true);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const input: CourtInput = { name, openTime, closeTime, isActive };
		const parsed = courtInputSchema.safeParse(input);
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "Please check the form.");
			return;
		}
		startTransition(async () => {
			try {
				const result = court
					? await updateCourt(court.id, parsed.data)
					: await createCourt(parsed.data);
				if (result.ok) {
					onDone();
				} else {
					setError(result.error);
				}
			} catch {
				setError("Failed to save court. Please try again.");
			}
		});
	}

	return (
		<form
			onSubmit={onSubmit}
			className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
		>
			<div className="font-medium">{court ? "Edit court" : "New court"}</div>

			<label className="block space-y-1">
				<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</span>
				<input
					type="text"
					required
					value={name}
					onChange={(e) => setName(e.target.value)}
					className={inputClass}
				/>
			</label>

			<div className="grid grid-cols-2 gap-3">
				<label className="block space-y-1">
					<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Open</span>
					<input
						type="time"
						required
						step={1800}
						value={openTime}
						onChange={(e) => setOpenTime(e.target.value)}
						className={inputClass}
					/>
				</label>
				<label className="block space-y-1">
					<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Close</span>
					<input
						type="time"
						required
						step={1800}
						value={closeTime}
						onChange={(e) => setCloseTime(e.target.value)}
						className={inputClass}
					/>
				</label>
			</div>

			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={isActive}
					onChange={(e) => setIsActive(e.target.checked)}
					className="h-4 w-4"
				/>
				<span className="font-medium text-zinc-700 dark:text-zinc-300">Active (bookable)</span>
			</label>

			{error && <p className="text-sm text-red-600">{error}</p>}

			<div className="flex gap-2">
				<button
					type="submit"
					disabled={pending}
					className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
				>
					{pending ? "Saving…" : "Save"}
				</button>
				<button
					type="button"
					onClick={onCancel}
					disabled={pending}
					className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
				>
					Cancel
				</button>
			</div>
		</form>
	);
}
