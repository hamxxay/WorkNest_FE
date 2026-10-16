// Space types belong to a location (dbo.WN_SpaceTypes.LocationId): every location has its own type rows, so a
// space type dropdown offers only the types of the location chosen in its form. The rows load once
// (GET api/spacetype, each with locationId / locationName) and are filtered here, in the browser.
// An older API returns rows without locationId: then nothing is filtered and every type shows, as before.

/** Under a space type dropdown whose form has no location yet. */
export const CHOOSE_LOCATION_FIRST = 'Choose a location first';
/** Under a space type dropdown whose location has no space types. */
export const NO_TYPES_AT_LOCATION = 'No space types at this location yet.';

/** A location value from a form or a row (2, "2") as its id; null when there is none. */
export function toLocationId(value: unknown): number | null {
  if (value == null || value === '' || value === 'null') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The location a space type row belongs to (null on an older API). */
export function spaceTypeLocationId(row: any): number | null {
  return toLocationId(row?.locationId ?? row?.LocationId);
}

/** True when the rows say which location each type belongs to (the API has the location column). */
export function spaceTypesHaveLocations(rows: readonly any[] | null | undefined): boolean {
  return (rows ?? []).some(r => spaceTypeLocationId(r) != null);
}

/**
 * The space types a form may offer for the location it has chosen:
 * - older API (rows without locationId): every type, as before;
 * - no location chosen yet: none;
 * - otherwise only that location's types.
 */
export function spaceTypesForLocation<T>(rows: readonly T[] | null | undefined, locationId: unknown): T[] {
  const list = rows ?? [];
  if (!spaceTypesHaveLocations(list)) return [...list];
  const loc = toLocationId(locationId);
  return loc == null ? [] : list.filter(r => spaceTypeLocationId(r) === loc);
}

const NONE: readonly never[] = Object.freeze([]);

/** Rows grouped by the location they belong to; build it once per load (computed) and read it with spaceTypesAt. */
export function spaceTypesByLocation<T>(rows: readonly T[] | null | undefined): Map<number, T[]> {
  const byLocation = new Map<number, T[]>();
  for (const r of rows ?? []) {
    const loc = spaceTypeLocationId(r);
    if (loc == null) continue;
    const list = byLocation.get(loc);
    if (list) list.push(r); else byLocation.set(loc, [r]);
  }
  return byLocation;
}

/**
 * Same as spaceTypesForLocation, but returns the same array for the same location (for template bindings):
 * `rows` itself on an older API, the location's list from `byLocation`, or one shared empty list.
 */
export function spaceTypesAt<T>(rows: readonly T[], byLocation: Map<number, T[]>, locationId: unknown): readonly T[] {
  if (!spaceTypesHaveLocations(rows)) return rows;
  const loc = toLocationId(locationId);
  return (loc != null ? byLocation.get(loc) : undefined) ?? NONE;
}

/** Hint under a filtered space type dropdown; '' when it has options or nothing is filtered (older API). */
export function spaceTypeHint(rows: readonly any[] | null | undefined, locationId: unknown, optionCount: number): string {
  if (optionCount > 0 || !spaceTypesHaveLocations(rows)) return '';
  return toLocationId(locationId) == null ? CHOOSE_LOCATION_FIRST : NO_TYPES_AT_LOCATION;
}

/** A space type row's name for a dropdown ("PrivateOffice" reads "Private Office"). */
export function spaceTypeLabel(row: any): string {
  const name = String(row?.name ?? row?.Name ?? row?.displayName ?? row?.description ?? '').trim();
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
}

/** The category code of a space type or space row (WN_SpaceCategories.Code, e.g. 'PrivateOffice'); '' if unknown. */
export function spaceCategoryCode(row: any): string {
  return String(row?.categoryCode ?? row?.CategoryCode ?? '').trim();
}
