import { SettingsPanel } from "@/components/dashboard/settings-panel";

export default function SettingsPage() {
	return (
		<section>
			<h2 className="mb-1 text-lg font-semibold">Settings</h2>
			<p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
				Flat hourly rate and the payment QR shown to customers.
			</p>
			<SettingsPanel />
		</section>
	);
}
