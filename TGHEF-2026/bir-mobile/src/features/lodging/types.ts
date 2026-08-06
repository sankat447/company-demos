/**
 * CO-003 participant lodging & badges — shared model. Room inventory is
 * admin-maintained (ASK #27); the allocation engine (PR-3) consumes these
 * types; the commit is a backend mutation that re-validates every hard
 * constraint server-side (ASK #29).
 */

export type RoomType = 'twin' | 'double' | 'triple' | 'dorm';
export type RoomStatus = 'active' | 'held' | 'retired';

export interface Room {
  id: string;
  hotelName: string;
  /** Links to a Hospitality Partner property when applicable. */
  propertyId?: string;
  roomLabel: string;
  type: RoomType;
  /** Beds. */
  capacity: number;
  /** One shared bed — couples-eligible, exclusively theirs when used. */
  doubleOccupancy: boolean;
  availability: { from: string; to: string; nights: string[] };
  amenitiesNote?: string;
  contactPhone?: string;
  status: RoomStatus;
}

export type Gender = 'female' | 'male' | 'other' | 'undisclosed';

export interface Participant {
  /** Registration id (reg:<sub>:<item>:<slot>). */
  regId: string;
  name: string;
  competitionId: string;
  /** Lodging-only data: admin screens only, never on badges or rosters. */
  gender: Gender;
  coupleGroupId?: string;
  nights: string[];
  needsLodging: boolean;
  notes?: string;
}

export interface Assignment {
  regId: string;
  roomId: string;
}

export type UnplacedReason = 'needs-manual' | 'no-capacity' | 'couple-mismatch';

export interface Unplaced {
  regId: string;
  reason: UnplacedReason;
}

export interface Proposal {
  assignments: Assignment[];
  unplaced: Unplaced[];
}

/** The lodging window: nights of 20–24 Nov (a night is its start date). */
export const LODGING_NIGHTS = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'] as const;
