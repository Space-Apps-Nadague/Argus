import type { Db } from '../db/client';

export type Role = 'admin' | 'astronaut' | 'flight_surgeon';

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  astronautId: string | null;
  sessionId: string;
}

/** Hono context variables set by `dbMiddleware` / `sessionMiddleware`. */
export interface AppEnv {
  Variables: {
    db: Db | null;
    user: SessionUser | null;
  };
}
