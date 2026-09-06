import type { ProtoFileHeader } from './types.js';

export type ProtoIssueLevel = 'error' | 'warning';

export type ProtoIssueCode =
  'missing_output' | 'proto_override' | 'bad_syntax' | 'missing_package';

export interface ProtoIssue {
  level: ProtoIssueLevel;
  code: ProtoIssueCode;
  message: string;
  path?: string;
}

export interface ProtoProcedureCheck {
  path: string;
  hasOutput: boolean;
  proto?: ProtoFileHeader;
}

export interface ProtoPrevalidateInput {
  defaultProto?: ProtoFileHeader;
  procedures: ProtoProcedureCheck[];
}

function sameProto(
  left: ProtoFileHeader | undefined,
  right: ProtoFileHeader | undefined,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Approved tRPC→proto subset. Collects every issue; `error` is fatal.
 * `proto.package` is required. `syntax` defaults to proto3. `cache` is optional.
 */
export function prevalidate(input: ProtoPrevalidateInput): ProtoIssue[] {
  const issues: ProtoIssue[] = [];
  const header = input.defaultProto;

  if (!header?.package) {
    issues.push({
      level: 'error',
      code: 'missing_package',
      message: 'proto.package is required',
    });
  }
  if (header?.syntax !== undefined && header.syntax !== 'proto3') {
    issues.push({
      level: 'error',
      code: 'bad_syntax',
      message: `defaultMeta.proto.syntax must be "proto3", got ${JSON.stringify(header.syntax)}`,
    });
  }

  for (const procedure of input.procedures) {
    if (!procedure.hasOutput) {
      issues.push({
        level: 'error',
        code: 'missing_output',
        message: `procedure ${procedure.path} missing required output`,
        path: procedure.path,
      });
    }
    if (procedure.proto && !sameProto(procedure.proto, header)) {
      issues.push({
        level: 'error',
        code: 'proto_override',
        message: `procedure ${procedure.path} overrides proto meta`,
        path: procedure.path,
      });
    }
  }

  return issues;
}

function procedureKey(path: string) {
  return path.split('.').at(-1) ?? path;
}

function exampleFor(issue: ProtoIssue): string {
  const key = issue.path ? procedureKey(issue.path) : undefined;
  switch (issue.code) {
    case 'missing_output':
      return `  ${key}: t.procedure
    .output(z.object({ ok: z.boolean() }))
    .query(...)`;
    case 'proto_override':
      return `  initTRPC.meta<ProtoMeta>().create({
    defaultMeta: { proto: { package: 'your.package.v1' } },
  })`;
    case 'bad_syntax':
      return `  proto: { syntax: 'proto3' }`;
    case 'missing_package':
      return `  defaultMeta: { proto: { package: 'your.package.v1' } }`;
  }
}

export function formatIssues(issues: ProtoIssue[], file?: string): string {
  const lines = file ? [file] : [];
  for (const issue of issues) {
    lines.push(`${issue.level}: ${issue.message}`);
    for (const line of exampleFor(issue).split('\n')) lines.push(line);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export class PrevalidateError extends Error {
  override name = 'PrevalidateError';
  readonly issues: ProtoIssue[];
  readonly file?: string;

  constructor(issues: ProtoIssue[], file?: string) {
    const message = formatIssues(issues, file);
    super(message);
    this.issues = issues;
    this.file = file;
    this.stack = `${this.name}: ${message}`;
  }
}

export function assertPrevalidate(issues: ProtoIssue[], file?: string): void {
  if (!issues.some((issue) => issue.level === 'error')) return;
  throw new PrevalidateError(issues, file);
}
