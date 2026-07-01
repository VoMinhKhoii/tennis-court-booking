"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

/**
 * The app's atmosphere layer — one fixed, full-bleed surface behind all content.
 *  - Landing ("/") and Booking ("/availability"): the court photo under a single
 *    flat scrim (no gradient) — a quiet, even wash that keeps content readable.
 *  - Everywhere else: a slow ombre drifting through the palette's greens (frozen
 *    under prefers-reduced-motion via globals.css).
 */
export function SiteBackground() {
	const pathname = usePathname();
	const isHome = pathname === "/";
	const showPhoto = isHome || pathname === "/availability";

	return (
		<div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
			{showPhoto ? (
				<>
					<Image
						src="/tennis-court-background.webp"
						alt=""
						fill
						priority={isHome}
						sizes="100vw"
						className="object-cover object-center"
					/>
					<div className="absolute inset-0 bg-paper/75" />
				</>
			) : (
				<div className="app-ombre absolute inset-0" />
			)}
		</div>
	);
}
