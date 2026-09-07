export function assumeExhaustive(value: never): never {
  throw new Error(`unexpected value: ${String(value)}`);
}

type ExhaustivenessCheck<TActual, TAllowed> = [
  Exclude<TActual, TAllowed>,
] extends [never]
  ? [Exclude<TAllowed, TActual>] extends [never]
    ? unknown
    : {
        readonly ERROR: 'TAllowed contains cases already handled or impossible';
        readonly REDUNDANT_CASES: Exclude<TAllowed, TActual>;
      }
  : {
      readonly ERROR: 'Unhandled value is not covered by TAllowed';
      readonly UNHANDLED_CASES: Exclude<TActual, TAllowed>;
    };

export function assumeExhaustiveAllowing<TAllowed, TActual>(
  _value: TActual & ExhaustivenessCheck<TActual, TAllowed>,
  _message?: string,
): void {}
