import postgres from 'postgres';

const APP_POOL_OPTIONS = {
	max: 4,
	idle_timeout: 20,
	max_lifetime: 60 * 30
};

const WORKER_POOL_OPTIONS = {
	max: 1,
	idle_timeout: 5,
	max_lifetime: 60 * 10
};

export function createAppClient(databaseUrl: string) {
	return postgres(databaseUrl, APP_POOL_OPTIONS);
}

export function createWorkerClient(databaseUrl: string) {
	return postgres(databaseUrl, WORKER_POOL_OPTIONS);
}
