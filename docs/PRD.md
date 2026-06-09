# Tennis Court Booking System — PRD

**Client type:** Single owner-operator, 1–4 courts, Vietnam
**Scale:** Max 100 MAU
**Communication layer:** Zalo
**Payment model:** Tier 1 manual verification, Tier 2 upgrade-ready
**Audience:** 30–40 yr old coaches, students, recreational players — existing relationships, Zalo-native, all Vietnamese

## Core Concepts

- **Court:** A physical court, 15 operational hours/day. Up to 4 courts total.
- **Monthly Booking:** A recurring weekly slot held by a group or individual. Locked in for the month. 13–14 hours/court/day are typically filled this way. These are the primary customers.
- **Ad-hoc Booking:** A one-off slot from the remaining ~1 hour/court/day. Secondary priority.
- **Pending Booking:** A booking row created when a customer locks in a slot. Holds the slot temporarily. Not visible as available to others. Expires if owner does not confirm within a defined window (e.g. 2 hours).
- **Confirmed Booking:** Owner has verified payment and tapped confirm. Slot is locked. Zalo notification fires.
- **Owner Dashboard:** The sole admin interface. All confirm/reject/edit actions live here. No other user has write access.

## User Journeys

### Journey 1 — Monthly Group Booking (Primary)

1. Customer messages owner on Zalo asking about available slots
2. Owner checks dashboard, identifies available slot, sends customer the booking link
3. Customer opens web, sees availability calendar, selects desired recurring slot and duration
4. Customer fills in name, Zalo number, group size
5. System creates a pending booking row, displays owner's static bank QR + transfer amount + unique booking reference number in the transfer note
6. Customer transfers, screenshots confirmation, sends screenshot + booking reference to owner on Zalo
7. Owner opens dashboard, sees pending booking flagged, cross-checks screenshot
8. Owner taps Confirm — booking moves to confirmed, slot locks on calendar
9. System sends automated Zalo message to customer: slot details, date, time, court number, recurring schedule for the month
10. Booking appears on public availability display as occupied

**Expiry handling:** If owner does not confirm within {n} hours, pending booking auto-expires and slot reopens. System notifies owner of the expiry.

### Journey 2 — Ad-hoc Single Slot Booking

Same as Journey 1 but no recurring schedule. Steps 1–9 identical. Step 9 confirmation message contains single session details only.

### Journey 3 — Monthly Renewal

1. System detects monthly booking approaching end of month (e.g. 5 days before)
2. System sends automated Zalo reminder to customer: "Your slot [time, court] renews [date]. Reply to confirm renewal."
3. Customer replies to owner on Zalo confirming renewal
4. Owner taps Renew on dashboard for that booking row
5. New month's pending booking row created
6. Customer transfers, screenshots, sends to owner — same flow as Journey 1 from step 6

### Journey 4 — Owner Rejects or Expires a Pending Booking

1. Owner reviews pending booking, decides not to confirm (wrong amount, suspicious, slot conflict)
2. Owner taps Reject with optional reason note
3. System releases the slot back to available
4. System sends automated Zalo message to customer notifying them the booking was not confirmed, with owner contact for follow-up

### Journey 5 — Owner Posts Empty Slots to Facebook Groups

1. System detects ad-hoc slots unfilled for the coming week
2. System generates a pre-written post draft: available times, court, price, booking link
3. Owner reviews draft, copies and pastes to relevant Facebook groups manually
4. Interested parties message owner on Zalo — flow continues from Journey 1 step 2

> Note: Post generation is AI-assisted, posting is manual. Facebook API does not support automated group posting.

## Features

### Availability Display (Public)

- Calendar view showing available vs. occupied slots per court per day
- No login required to view
- Updates in real time when bookings are confirmed or expire
- Does not show customer names or booking details — only available/occupied status
- Mobile-optimised, shareable link

### Booking Form (Public)

- Accessible via link sent by owner or directly from availability display
- Fields: name, Zalo number, court preference, date/time slot, session type (monthly/weekly or ad-hoc), group size
- On submit: creates pending booking row, displays QR + transfer instructions
- Unique booking reference generated and shown — customer must include in transfer note
- No account creation required

### Owner Dashboard (Private)

- Login protected, owner only
- Pending bookings queue — sorted by creation time, flagged if approaching expiry
- One-tap Confirm / Reject per pending booking
- Confirmed bookings view — filterable by court, month, customer
- Manual booking creation — owner can create a confirmed booking directly without customer going through the form (for existing regulars)
- Renewal management — view upcoming monthly expirations, trigger renewal flow
- Court management — add/edit courts, set operational hours, block out dates (maintenance, holidays)

### Zalo Notification Triggers (Automated)

- Booking confirmed
- Booking rejected
- Pending booking expired
- Monthly renewal reminder
- Ad-hoc slots unfilled 48h / {n} hours before

All messages sent via Zalo Official Account. Template messages, owner can edit wording in dashboard settings.

### Stock Tracking

- Owner-managed inventory list: drinks, equipment, consumables

### AI Post Draft Generator

- Pulls unfilled ad-hoc slots for the coming week from the database
- Generates a ready-to-copy Facebook/Zalo group post in Vietnamese
- Owner reviews and posts manually
- Tone and format editable in dashboard settings
