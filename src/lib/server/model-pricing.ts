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
	// Claude 4.6 (verified Mar 2026)
	'claude-opus-4.6': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	'claude-opus-4-6': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	'claude-sonnet-4.6': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	// Claude 4.5 (verified Jan 2026)
	'claude-opus-4.5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	'claude-opus-4-5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	'claude-sonnet-4.5': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	'claude-sonnet-4-5': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	'claude-haiku-4.5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
	'claude-haiku-4-5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
	// Gemini 3 (verified Jan 2026)
	'gemini-3-pro': { input: 2, output: 12, cache_read: 0.2 },
	'gemini-3-flash': { input: 0.5, output: 3, cache_read: 0.05 },
	// Gemini 2.5 (verified)
	'gemini-2.5-pro': { input: 1.25, output: 10 },
	'gemini-2.5-flash': { input: 0.3, output: 2.5 },
	// OpenAI GPT-5 (verified Mar 2026)
	'gpt-5.4': { input: 2.5, output: 15 },
	'gpt-5.3': { input: 3, output: 15 },
	'gpt-5.3-codex': { input: 3, output: 15 },
	'gpt-5.2-codex': { input: 1.75, output: 14 },
	'gpt-5.2': { input: 1.25, output: 10 },
	'gpt-5.1': { input: 1.25, output: 10 },
	'gpt-5': { input: 1.25, output: 10 },
	'codex-mini': { input: 1.5, output: 6 },
	'codex-mini-latest': { input: 1.5, output: 6 },
	'gpt-4o': { input: 2.5, output: 10 },
	// xAI Grok (verified Jan 2026 - grok-code-fast pricing)
	'grok-code': { input: 0.2, output: 1.5 },
	'grok-code-fast': { input: 0.2, output: 1.5 },
	'grok-3': { input: 3, output: 15 },
	'grok': { input: 0.2, output: 1.5 },
	// GLM (Zhipu AI / Z.AI) - estimated from official CNY pricing
	'glm-4.7-free': { input: 0.6, output: 2.2 },
	'glm-4.7': { input: 0.6, output: 2.2 },
	'glm-5-free': { input: 0.7, output: 2.8 },
	'glm-5': { input: 0.7, output: 2.8 },
	'z-ai/glm-5:free': { input: 0.7, output: 2.8 },
	'z-ai/glm-4.7:free': { input: 0.6, output: 2.2 },
	// MiniMax (estimated from official pricing ~5 CNY/M input, ~15 CNY/M output)
	'minimax-m2.5-free': { input: 0.7, output: 2.1 },
	'minimax-m2.5': { input: 0.7, output: 2.1 },
	// Moonshot AI Kimi (estimated from official pricing ~12 CNY/M)
	'kimi-k2.5-free': { input: 0.84, output: 2.52 },
	'kimi-k2.5': { input: 0.84, output: 2.52 },
	'moonshotai/kimi-k2.5:free': { input: 0.84, output: 2.52 },
	// StepFun Step (estimated from official pricing)
	'stepfun/step-3.5-flash:free': { input: 0.14, output: 0.56 },
	'step-3.5-flash': { input: 0.14, output: 0.56 },
	// Xiaomi MiMo-V2-Flash (verified Jan 2026 - Xiaomi official pricing)
	'xiaomi/mimo-v2-flash:free': { input: 0.1, output: 0.3 },
	'mimo-v2-flash': { input: 0.1, output: 0.3 },
	'mimo': { input: 0.1, output: 0.3 },
	// Unknown/other
	'big-pickle': { input: 0, output: 0 }
};

const perMillion = 1_000_000;

export const normalizeModelId = (modelId: string): string => {
	let m = modelId.toLowerCase();
	m = m.replace(/^antigravity-/, '');
	m = m.replace(/-thinking.*$/, '');
	m = m.replace(/-20\d{6}$/, '');
	m = m.replace(/-preview$/, '');
	m = m.replace(/-high$/, '');
	m = m.replace(/-medium$/, '');
	m = m.replace(/-low$/, '');

	if (m.includes('claude-opus-4-6') || m.includes('claude-opus-4.6')) return 'claude-opus-4.6';
	if (m.includes('claude-sonnet-4-6') || m.includes('claude-sonnet-4.6')) return 'claude-sonnet-4.6';
	if (m.includes('claude-opus-4')) return 'claude-opus-4.5';
	if (m.includes('claude-sonnet-4')) return 'claude-sonnet-4.5';
	if (m.includes('claude-haiku-4')) return 'claude-haiku-4.5';
	if (m.includes('gemini-3-pro')) return 'gemini-3-pro';
	if (m.includes('gemini-3-flash')) return 'gemini-3-flash';
	if (m.includes('gemini-2.5-pro') || m.includes('gemini-2-5-pro')) return 'gemini-2.5-pro';
	if (m.includes('gemini-2.5-flash') || m.includes('gemini-2-5-flash')) return 'gemini-2.5-flash';
	if (m.includes('gpt-5.4') || m.includes('gpt-5-4')) return 'gpt-5.4';
	if (m.includes('gpt-5.3-codex') || m.includes('gpt-5-3-codex')) return 'gpt-5.3-codex';
	if (m.includes('gpt-5.3') || m.includes('gpt-5-3')) return 'gpt-5.3';
	if (m.includes('gpt-5.2-codex') || m.includes('gpt-5-2-codex')) return 'gpt-5.2-codex';
	if (m.includes('gpt-5.2') || m.includes('gpt-5-2')) return 'gpt-5.2';
	if (m.includes('gpt-5.1') || m.includes('gpt-5-1')) return 'gpt-5.1';
	if (m.includes('codex-mini')) return 'codex-mini';
	if (m.includes('gpt-4o')) return 'gpt-4o';
	if (m.includes('grok')) return 'grok-code';
	if (m.includes('glm-5')) return 'glm-5';
	if (m.includes('glm-4.7')) return 'glm-4.7';
	if (m.includes('minimax-m2.5')) return 'minimax-m2.5';
	if (m.includes('kimi-k2.5')) return 'kimi-k2.5';
	if (m.includes('step-3.5-flash')) return 'step-3.5-flash';
	if (m.includes('mimo-v2-flash') || m.includes('mimo')) return 'mimo-v2-flash';

	return m;
};

const MODEL_DISPLAY_NAMES: Record<string, string> = {
	'claude-opus-4.6': 'Claude Opus 4.6',
	'claude-sonnet-4.6': 'Claude Sonnet 4.6',
	'claude-opus-4.5': 'Claude Opus 4.5',
	'claude-sonnet-4.5': 'Claude Sonnet 4.5',
	'claude-haiku-4.5': 'Claude Haiku 4.5',
	'gemini-3-pro': 'Gemini 3 Pro',
	'gemini-3-flash': 'Gemini 3 Flash',
	'gemini-2.5-pro': 'Gemini 2.5 Pro',
	'gemini-2.5-flash': 'Gemini 2.5 Flash',
	'gpt-5.4': 'GPT-5.4',
	'gpt-5.3': 'GPT-5.3',
	'gpt-5.3-codex': 'GPT-5.3 Codex',
	'gpt-5.2-codex': 'GPT-5.2 Codex',
	'gpt-5.2': 'GPT-5.2',
	'gpt-5.1': 'GPT-5.1',
	'codex-mini': 'Codex Mini',
	'gpt-4o': 'GPT-4o',
	'grok-code': 'Grok',
	'glm-5': 'GLM-5',
	'glm-4.7': 'GLM-4.7',
	'minimax-m2.5': 'MiniMax M2.5',
	'kimi-k2.5': 'Kimi K2.5',
	'step-3.5-flash': 'Step 3.5 Flash',
	'mimo-v2-flash': 'MiMo V2 Flash'
};

export const getModelDisplayName = (modelId: string): string => {
	const normalized = normalizeModelId(modelId);
	return MODEL_DISPLAY_NAMES[normalized] || normalized;
};

const getModelCost = (providerId?: string | null, modelId?: string | null): ModelCost | null => {
	if (!modelId) return null;

	if (providerId) {
		const exactKey = `${providerId}:${modelId}`;
		const exact = pricingByProviderModel.get(exactKey);
		if (exact && (exact.input || exact.output)) return exact;
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
