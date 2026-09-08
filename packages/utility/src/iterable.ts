export function isAsyncIterable<Value>(
  value: Value | AsyncIterable<Value>,
): value is AsyncIterable<Value> {
  return (
    value !== null &&
    value !== undefined &&
    typeof (value as AsyncIterable<Value>)[Symbol.asyncIterator] === 'function'
  );
}
