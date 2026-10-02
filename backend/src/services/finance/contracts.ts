/** Phase 1-2 placeholder contracts are superseded by the implementations exported from ./index.ts. */
export class RuleNotConfiguredError extends Error {
  constructor(rule: string) { super(`Business rule "${rule}" has not been configured yet`); }
}
