/**
 * Add-to-calendar for confirmed registrations (P5.9). expo-calendar is
 * loaded lazily (native module); returns false when permission is declined
 * or no writable calendar exists — callers surface a soft failure only.
 */
import type { HighlightItem, Slot } from './types';

export interface CalendarEventInput {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
}

/** Pure: derive the event window from slot or first date (18:00 default). */
export function eventWindow(item: HighlightItem, slot?: Slot): { start: Date; end: Date } | null {
  if (slot) {
    const start = new Date(slot.startsAtSec * 1000);
    const end = slot.endsAtSec
      ? new Date(slot.endsAtSec * 1000)
      : new Date(start.getTime() + 60 * 60 * 1000);
    return { start, end };
  }
  const firstDate = item.dates[0];
  if (!firstDate) return null;
  const start = new Date(`${firstDate}T18:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 2 * 60 * 60 * 1000) };
}

export async function addToDeviceCalendar(event: CalendarEventInput): Promise<boolean> {
  try {
    const Calendar = await import('expo-calendar');
    const permission = await Calendar.requestCalendarPermissionsAsync();
    if (!permission.granted) return false;

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.find((c) => c.allowsModifications);
    if (!writable) return false;

    await Calendar.createEventAsync(writable.id, {
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location,
    });
    return true;
  } catch {
    return false;
  }
}
