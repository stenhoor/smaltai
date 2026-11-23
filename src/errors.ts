/** Error codes smaltai throws with. */
export type SmaltaiErrorCode =
  | 'SMALTAI_CREDENTIAL_REFUSED'
  | 'SMALTAI_ENDPOINT_INVALID'
  | 'SMALTAI_GATEWAY_ERROR'
  | 'SMALTAI_GATEWAY_UNREACHABLE'
  | 'SMALTAI_STREAM_INVALID'
  | 'SMALTAI_GRANT_INVALID'
  | 'SMALTAI_ACTION_INVALID'
  | 'SMALTAI_ABORTED';

/** Every error smaltai throws on purpose carries a code. */
export class SmaltaiError extends Error {
  readonly code: SmaltaiErrorCode;
  /** For `SMALTAI_GATEWAY_ERROR`: the HTTP status. */
  readonly status?: number;

  constructor(code: SmaltaiErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SmaltaiError';
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
  }
}
