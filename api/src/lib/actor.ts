import type { SessionUser } from '@coach/contracts';

/** The authenticated caller, as established from the JWT. */
export type Actor = SessionUser;
export type Clock = () => Date;
