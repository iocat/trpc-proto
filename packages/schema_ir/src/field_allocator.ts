const MAX_TAG = 536_870_911;
const RESERVED_TAG_RANGE = [19_000, 19_999] as const;

function isReserved(tag: number) {
  return tag >= RESERVED_TAG_RANGE[0] && tag <= RESERVED_TAG_RANGE[1];
}

function advance(nextTag: number, usedTags: Set<number>) {
  while (nextTag <= MAX_TAG && (usedTags.has(nextTag) || isReserved(nextTag))) {
    nextTag = isReserved(nextTag) ? RESERVED_TAG_RANGE[1] + 1 : nextTag + 1;
  }
  return nextTag;
}

function assertValidTag(tag: number, usedTags: Set<number>) {
  if (tag < 1 || tag > MAX_TAG) {
    throw new Error(`Protobuf tag ${tag} out of range (1..536870911).`);
  }
  if (isReserved(tag)) {
    throw new Error(`Protobuf tag ${tag} is in reserved range (19000..19999).`);
  }
  if (usedTags.has(tag)) {
    throw new Error(`Duplicate protobuf tag ${tag} assigned.`);
  }
}

function* allocate(
  assignments: Record<string, number>,
): Generator<number, never, number> {
  const usedTags = new Set<number>(Object.values(assignments));
  let nextTag = advance(1, usedTags);
  // First next() is ignored by the language; createFieldAllocator consumes it.
  let sent: number | undefined = yield 0;

  while (nextTag <= MAX_TAG) {
    const tag: number = sent ?? nextTag;
    assertValidTag(tag, usedTags);
    usedTags.add(tag);
    if (tag >= nextTag) nextTag = tag + 1;
    nextTag = advance(nextTag, usedTags);
    sent = yield tag;
  }

  throw new Error("Exhausted maximum Protobuf field numbers.");
}

/**
 * Yields the assigned tag. `next()` auto-assigns; `next(tag)` claims `tag`.
 */
export function createFieldAllocator(
  assignments: Record<string, number> = {},
): Generator<number, never, number> {
  const gen = allocate(assignments);
  gen.next();
  return gen;
}
