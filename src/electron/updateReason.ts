/** Why an update failed, in a few plain categories the UI can explain. */
export type UpdateFailReason = 'offline' | 'timeout' | 'disk' | 'corrupt';

const RULES: ReadonlyArray<readonly [UpdateFailReason, RegExp]> = [
  ['disk', /ENOSPC|no space left|disk full/i],
  ['timeout', /ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out|timeout/i],
  [
    'offline',
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENETDOWN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ERR_CONNECTION/i,
  ],
  ['corrupt', /sha512|sha256|checksum|corrupt|signature|ERR_UPDATER_(?!.*NOT_FOUND)/i],
];

/** Classify a raw updater error message. Returns undefined when no known cause matches. */
export function classifyUpdateError(message: string): UpdateFailReason | undefined {
  for (const [reason, pattern] of RULES) {
    if (pattern.test(message)) return reason;
  }
  return undefined;
}
