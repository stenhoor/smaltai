/** Error codes smaltai throws with. */
export type SmaltaiErrorCode =
  | 'CREDENTIAL_REFUSED'
  | 'ENDPOINT_INVALID'
  | 'GATEWAY_ERROR'
  | 'GATEWAY_UNREACHABLE'
  | 'STREAM_INVALID'
  | 'GRANT_INVALID'
  | 'ACTION_UNKNOWN'
  | 'ABORTED';

/** Every error smaltai throws on purpose carries a code. */
export class SmaltaiError extends Error {
  readonly code: SmaltaiErrorCode;
  /** For `GATEWAY_ERROR`: the HTTP status. */
  readonly status?: number;

  constructor(code: SmaltaiErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SmaltaiError';
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
  }
}
