import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '$lib/db/schema';
import { env } from '$env/dynamic/private';
import { createAppClient } from '$lib/server/postgres-client';

export const client = createAppClient(env.DATABASE_URL!);
export const db = drizzle(client, { schema });
