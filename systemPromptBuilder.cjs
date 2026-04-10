/**
 * System Prompt 共享构建器（CJS）
 * experience.js（推理）和 server.js（export）共用同一套 prompt 构建逻辑
 */

const db = require('./db.js');

// ***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED*** Reply Style（前后端共用）***REMOVED******REMOVED******REMOVED******REMOVED******REMOVED***

const REPLY_STYLE = `【回复风格 — 严格遵守】
- 语气自然亲切，像朋友间发消息，不要生硬刻板
- 句子要短，每条不超过 80 字
- 用换行分隔要点，避免一大段文字
- 主动推进下一步行动，不要只停留在当前问题
- 称呼客户名字（如果有），显得更personal
- 句尾可以有 "~" 或 "!" 体现热情

【各场景 emoji 参考】
- 试用/邀请：🎉 ✨ 🙌
- 月卡/付费：💎 💳 📅
- GMV/业绩：📈 💰 🔥
- 视频/内容：📹 🎬 ✨
- 付款问题：💳 ⚠️ 🔔
- 申诉/违规：🔒 📋 🆘
- 建联/开场：👋 😊 ✨
- 推荐用户：🤝 🎁 🙌`;

/**
 * 完整的 system prompt 构建（与推理时完全一致）
 *
 * @param {string|null} clientId - 达人 phone（用于查 operator、client_memory）
 * @param {string} scene - 当前场景
 * @param {Array} messages - 对话历史（[{role, text}]，可空）
 * @param {Object} opts - 可选参数
 * @param {string} opts.operator - 手动传入 operator（跳过 DB 查询）
 * @param {string} opts.topicContext - 前端构建的话题上下文（topicContext）
 * @param {string} opts.richContext - 前端构建的丰富上下文段落（richContextParagraph）
 * @param {string} opts.conversationSummary - 前端构建的更早对话摘要（convSummary.summary）
 * @param {string} opts.systemPromptVersion - Prompt 版本标识，默认 'v2'
 */
function buildFullSystemPrompt(clientId, scene, messages = [], opts = {}) {
	const {
		operator: forcedOperator = null,
		topicContext = '',
		richContext = '',
		conversationSummary = '',
		systemPromptVersion = 'v2',
	} = opts;

	const dbInstance = db.getDb();

	// 1. 确定 operator
	let operator = forcedOperator;
	let clientInfo = { name: '未知', conversion_stage: '未知', next_action: null };

	if (!operator && clientId) {
		const creator = dbInstance.prepare(`
			SELECT c.primary_name as name, c.wa_owner, wc.beta_status as conversion_stage, wc.next_action
			FROM creators c
			LEFT JOIN wa_crm_data wc ON wc.creator_id = c.id
			WHERE c.wa_phone = ?
		`).get(clientId);
		if (creator) {
			operator = creator.wa_owner;
			clientInfo = {
				name: creator.name || '未知',
				conversion_stage: creator.conversion_stage || '未知',
				next_action: creator.next_action || null,
			};
		}
	}

	const promptParts = [];

	// 前端注入的上下文（话题上下文 + 丰富上下文 + 更早摘要）
	// 这确保 sft-export 训练时的 prompt 与推理时完全一致
	if (topicContext) {
		promptParts.push(topicContext);
	}
	if (richContext) {
		promptParts.push(richContext);
	}
	if (conversationSummary) {
		promptParts.push(conversationSummary);
	}

	if (!operator) {
		// 无法确定 operator，返回基础 prompt
		promptParts.push(buildBasePrompt(clientInfo, scene));
		return { prompt: promptParts.join('\n\n'), version: systemPromptVersion };
	}

	// 2. 获取 operator experience
	const exp = dbInstance.prepare(
		'SELECT * FROM operator_experiences WHERE operator = ? AND is_active = 1'
	).get(operator);
	if (!exp) {
		promptParts.push(buildBasePrompt(clientInfo, scene));
		return { prompt: promptParts.join('\n\n'), version: systemPromptVersion };
	}

	// 3. 获取客户记忆
	let clientMemory = [];
	if (clientId) {
		clientMemory = dbInstance.prepare(
			'SELECT * FROM client_memory WHERE client_id = ?'
		).all(clientId);
	}

	// 4. 获取政策文档
	const policyDocs = dbInstance.prepare(
		'SELECT * FROM policy_documents WHERE is_active = 1'
	).all().map(p => ({
		...p,
		applicable_scenarios: p.applicable_scenarios ? JSON.parse(p.applicable_scenarios) : []
	}));

	// 5. 编译核心 prompt（operator 专属规则 + 政策 + 禁止规则 + 回复风格）
	const corePrompt = compileSystemPrompt(operator, scene, clientInfo, clientMemory, policyDocs, exp);
	promptParts.push(corePrompt);

	return {
		prompt: promptParts.join('\n\n'),
		version: systemPromptVersion,
	};
}

/**
 * 编译完整的 system prompt（operator 已知时使用）
 */
function compileSystemPrompt(operator, scene, clientInfo, clientMemory, policyDocs, exp) {
	const sceneConfig = exp.scene_config ? JSON.parse(exp.scene_config) : {};
	const forbiddenRules = exp.forbidden_rules ? JSON.parse(exp.forbidden_rules) : [];

	let prompt = exp.system_prompt_base.replace('[BASE_PROMPT]', `
你是一个专业的达人运营助手，帮助运营人员与 WhatsApp 达人沟通。

【重要】你只能看到当前这一个客户的对话和档案，禁止推测或提及其他客户信息。

当前客户档案（仅以下信息可用于生成回复）：
- 姓名: ${clientInfo.name || '未知'}
- 负责人: ${operator}
- 建联阶段: ${clientInfo.conversion_stage || '未知'}
${clientInfo.next_action ? `- 运营计划: ${clientInfo.next_action}` : ''}
`.trim());

	// 场景适配片段
	if (scene && sceneConfig[scene]) {
		prompt += '\n\n【场景适配】' + sceneConfig[scene];
	}

	// 客户历史偏好
	if (clientMemory && clientMemory.length > 0) {
		const memoryText = formatClientMemory(clientMemory);
		prompt += '\n\n【客户历史偏好】以下信息仅供个性化参考：\n' + memoryText;
	}

	// 政策文档
	const scenePolicies = filterPoliciesByScene(policyDocs, scene);
	if (scenePolicies.length > 0) {
		prompt += '\n\n【场景适用政策 — 必须严格遵守】';
		for (const doc of scenePolicies) {
			if (doc.policy_content) {
				try {
					const content = typeof doc.policy_content ***REMOVED***= 'string'
						? JSON.parse(doc.policy_content)
						: doc.policy_content;
					prompt += '\n[' + doc.policy_key + ']';
					for (const [key, value] of Object.entries(content)) {
						if (Array.isArray(value)) {
							prompt += '\n  ' + key + ': ' + value.join('; ');
						} else {
							prompt += '\n  ' + key + ': ' + value;
						}
					}
				} catch (_) {
					prompt += '\n[' + doc.policy_key + '] ' + doc.policy_content;
				}
			}
		}
	}

	// 禁止规则
	const baseForbidden = [
		'具体 GMV 数字、收入数据（如 "$3,000"、"|GMV $5,000"）',
		'其他达人的姓名、状态、优先级等信息',
		'公司内部运营备注、合同条款、机构协议内容',
		'将客户与其他人做对比（如 "比起XX客户..."）',
	];
	const allForbidden = [...baseForbidden, ...forbiddenRules];

	prompt += '\n\n【输出禁止规则 — 严格遵守】\n你的回复中禁止出现以下内容：';
	allForbidden.forEach((rule, i) => {
		prompt += '\n' + (i + 1) + '. ' + rule;
	});

	prompt += '\n\n' + REPLY_STYLE;

	return prompt;
}

/**
 * 基础 prompt（无法确定 operator 时使用）
 */
function buildBasePrompt(clientInfo, scene) {
	let prompt = `
你是一个专业的达人运营助手，帮助运营人员与 WhatsApp 达人沟通。

【重要】你只能看到当前这一个客户的对话和档案，禁止推测或提及其他客户信息。

当前客户档案（仅以下信息可用于生成回复）：
- 姓名: ${clientInfo.name || '未知'}
- 建联阶段: ${clientInfo.conversion_stage || '未知'}
${clientInfo.next_action ? `- 运营计划: ${clientInfo.next_action}` : ''}
`.trim();

	if (scene && scene !***REMOVED*** 'unknown') {
		prompt += '\n\n【场景适配】场景: ' + scene;
	}

	prompt += '\n\n【输出禁止规则 — 严格遵守】\n你的回复中禁止出现以下内容：';
	const baseForbidden = [
		'具体 GMV 数字、收入数据（如 "$3,000"、"|GMV $5,000"）',
		'其他达人的姓名、状态、优先级等信息',
		'公司内部运营备注、合同条款、机构协议内容',
		'将客户与其他人做对比（如 "比起XX客户..."）',
	];
	baseForbidden.forEach((rule, i) => {
		prompt += '\n' + (i + 1) + '. ' + rule;
	});

	prompt += '\n\n' + REPLY_STYLE;

	return prompt;
}

function formatClientMemory(memory) {
	if (!memory || memory.length ***REMOVED***= 0) return '暂无';
	const lines = [];
	const byType = {};
	for (const m of memory) {
		if (!byType[m.memory_type]) byType[m.memory_type] = [];
		byType[m.memory_type].push(m.memory_key + '=' + m.memory_value);
	}
	for (const [type, items] of Object.entries(byType)) {
		lines.push('[' + type + ']: ' + items.join(', '));
	}
	return lines.join('\n');
}

function filterPoliciesByScene(policyDocs, scene) {
	if (!policyDocs || !scene) return [];
	return policyDocs.filter(p =>
		(p.applicable_scenarios || []).includes(scene)
	);
}

module.exports = { buildFullSystemPrompt };
