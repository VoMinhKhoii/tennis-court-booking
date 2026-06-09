"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

/**
 * The app's atmosphere layer — one fixed, full-bleed surface behind all content.
 *  - Landing ("/"): the court illustration under a light paper scrim so the hero
 *    and cards stay legible.
 *  - In-app (everything else): a slow, lively ombre drifting through the light
 *    greens of the palette (frozen under prefers-reduced-motion via globals.css).
 */
export function SiteBackground() {
	const pathname = usePathname();
	const isHome = pathname === "/";

	return (
		<div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
			{isHome ? (
				<>
					<Image
						src="/tennis-court-background.webp"
						alt=""
						fill
						priority
						sizes="100vw"
						className="object-cover object-center"
					/>
					<div className="home-scrim absolute inset-0" />
				</>
			) : (
				<div className="app-ombre absolute inset-0" />
			)}
		</div>
	);
}
