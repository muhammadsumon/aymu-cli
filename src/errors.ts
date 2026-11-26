// Exit codes and refusal errors (RELEASE_FORMAT 15.2; SECURITY_MODEL 11): 0 installed, 2 refused (conflict or
// incompatibility, nothing written), 3 verification failure (nothing written), 4 access or grant error, 1 other.
import type { CliVerificationCode } from '@aymu/domain';

export const EXIT = { ok: 0, other: 1, refused: 2, verification: 3, access: 4 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Codes that are refusals (exit 2) rather than verification failures (exit 3). */
const REFUSAL_CODES = new Set<string>(['incompatible_project', 'path_collision', 'target_exists', 'local_changes']);

export class CliError extends Error {
  readonly exitCode: ExitCode;
  /** A RELEASE_FORMAT 15.3 verification code, a server error code, or a CLI usage code. */
  readonly code: string;
  readonly details: readonly string[];

  constructor(exitCode: ExitCode, code: string, message: string, details: readonly string[] = []) {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
    this.details = details;
  }
}

/** A verification failure (exit 3) or, for the refusal codes, a refusal (exit 2). */
export function verificationError(
  code: CliVerificationCode,
  message: string,
  details: readonly string[] = [],
): CliError {
  return new CliError(REFUSAL_CODES.has(code) ? EXIT.refused : EXIT.verification, code, message, details);
}

export function usageError(message: string): CliError {
  return new CliError(EXIT.other, 'usage', message);
}

export function accessError(code: string, message: string): CliError {
  return new CliError(EXIT.access, code, message);
}
