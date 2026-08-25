const dateOnlyFields = new Set(["plantingDate"]);

function serialize(value: unknown, key?: string): unknown {
  if (value instanceof Date) return key && dateOnlyFields.has(key) ? value.toISOString().slice(0, 10) : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => serialize(item));
  if (typeof value === "object" && value !== null) {
    if ("toNumber" in value && typeof value.toNumber === "function") return value.toNumber();
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, serialize(entryValue, entryKey)]));
  }
  return value;
}

export function serializeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const serialized = serialize(record) as Record<string, unknown>;
  if (!("latitude" in serialized) && !("longitude" in serialized)) return serialized;
  const { latitude, longitude, ...result } = serialized;
  return { ...result, coordinates: latitude == null || longitude == null ? null : { latitude, longitude } };
}
