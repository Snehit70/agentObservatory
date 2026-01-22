import modelsDev from '$lib/assets/models.dev.json';

type ModelCost = {
	input?: number;
	output?: number;
	cache_read?: number;
	cache_write?: number;
	reasoning?: number;
};

type ModelsDevProvider = {
	models?: Record<string, { cost?: ModelCost }>;
};

const modelsDevData = modelsDev as Record<string, ModelsDevProvider>;

const pricingByProviderModel = Object.entries(modelsDevData).reduce(
	(map, [providerId, provider]) => {
		const models = provider.models ?? {};
		for (const [modelId, model] of Object.entries(models)) {
			if (model.cost) {
				map.set(`${providerId}:${modelId}`, model.cost);
			}
		}
		return map;
	},
	new Map<string, ModelCost>()
);

const FALLBACK_COSTS: Record<string, ModelCost> = {
	'claude-opus-4.5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	'claude-opus-4-5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	'claude-sonnet-4.5': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	'claude-sonnet-4-5': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	'claude-haiku-4.5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
	'claude-haiku-4-5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
	'gemini-3-pro': { input: 2, output: 12, cache_read: 0.2 },
	'gemini-3-flash': { input: 0.5, output: 3, cache_read: 0.05 },
	'gemini-2.5-pro': { input: 1.25, output: 10 },
	'gemini-2.5-flash': { input: 0.3, output: 2.5 },
	'gpt-5.2': { input: 3, output: 12 },
	'gpt-5.1': { input: 3, output: 12 },
	'gpt-4o': { input: 3, output: 10 },
	'grok-code': { input: 3, output: 15 },
	'grok-3': { input: 3, output: 15 }
};

const perMillion = 1_000_000;

const normalizeModelId = (modelId: string): string => {
	let m = modelId.toLowerCase();
	m = m.replace(/^antigravity-/, '');
	m = m.replace(/-thinking.*$/, '');
	m = m.replace(/-20\d{6}$/, '');
	m = m.replace(/-preview$/, '');

	if (m.includes('claude-opus-4')) return 'claude-opus-4.5';
	if (m.includes('claude-sonnet-4')) return 'claude-sonnet-4.5';
	if (m.includes('claude-haiku-4')) return 'claude-haiku-4.5';
	if (m.includes('gemini-3-pro')) return 'gemini-3-pro';
	if (m.includes('gemini-3-flash')) return 'gemini-3-flash';
	if (m.includes('gemini-2.5-pro') || m.includes('gemini-2-5-pro')) return 'gemini-2.5-pro';
	if (m.includes('gemini-2.5-flash') || m.includes('gemini-2-5-flash')) return 'gemini-2.5-flash';
	if (m.includes('gpt-5.2') || m.includes('gpt-5-2')) return 'gpt-5.2';
	if (m.includes('gpt-5.1') || m.includes('gpt-5-1')) return 'gpt-5.1';
	if (m.includes('gpt-4o')) return 'gpt-4o';
	if (m.includes('grok')) return 'grok-code';

	return m;
};

const getModelCost = (providerId?: string | null, modelId?: string | null): ModelCost | null => {
	if (!modelId) return null;

	if (providerId) {
		const exactKey = `${providerId}:${modelId}`;
		const exact = pricingByProviderModel.get(exactKey);
		if (exact) return exact;
	}

	const normalized = normalizeModelId(modelId);
	const fallback = FALLBACK_COSTS[normalized];
	if (fallback) return fallback;

	if (modelId.toLowerCase().includes('claude-opus')) {
		return FALLBACK_COSTS['claude-opus-4.5'];
	}
	if (modelId.toLowerCase().includes('claude-sonnet')) {
		return FALLBACK_COSTS['claude-sonnet-4.5'];
	}
	if (modelId.toLowerCase().includes('claude-haiku')) {
		return FALLBACK_COSTS['claude-haiku-4.5'];
	}
	if (modelId.toLowerCase().includes('gemini-3-pro')) {
		return FALLBACK_COSTS['gemini-3-pro'];
	}
	if (modelId.toLowerCase().includes('gemini-3-flash')) {
		return FALLBACK_COSTS['gemini-3-flash'];
	}

	return null;
};

const computeCostUsd = ({
	providerId,
	modelId,
	tokensInput = 0,
	tokensOutput = 0,
	tokensReasoning = 0,
	tokensCacheRead = 0,
	tokensCacheWrite = 0
}: {
	providerId?: string | null;
	modelId?: string | null;
	tokensInput?: number;
	tokensOutput?: number;
	tokensReasoning?: number;
	tokensCacheRead?: number;
	tokensCacheWrite?: number;
}) => {
	const cost = getModelCost(providerId, modelId);
	if (!cost) return null;
	const reasoningRate = cost.reasoning ?? cost.output ?? 0;
	return (
		(tokensInput * (cost.input ?? 0) +
			tokensOutput * (cost.output ?? 0) +
			tokensReasoning * reasoningRate +
			tokensCacheRead * (cost.cache_read ?? 0) +
			tokensCacheWrite * (cost.cache_write ?? 0)) /
		perMillion
	);
};

export const resolveCostUsd = ({
	costUsd,
	providerId,
	modelId,
	tokensInput = 0,
	tokensOutput = 0,
	tokensReasoning = 0,
	tokensCacheRead = 0,
	tokensCacheWrite = 0
}: {
	costUsd: number;
	providerId?: string | null;
	modelId?: string | null;
	tokensInput?: number;
	tokensOutput?: number;
	tokensReasoning?: number;
	tokensCacheRead?: number;
	tokensCacheWrite?: number;
}) => {
	const computed = computeCostUsd({
		providerId,
		modelId,
		tokensInput,
		tokensOutput,
		tokensReasoning,
		tokensCacheRead,
		tokensCacheWrite
	});
	return computed ?? costUsd;
};
