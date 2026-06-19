'use strict';

/**
 * Fast Tech WA Manager — AI Service
 * Supports Google Gemini and Anthropic Claude for script / copy generation.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

class AiService {
  constructor(db) {
    this._db = db;
  }

  // ─── Key management ───────────────────────────────────────────────────────
  _getKeys() {
    return {
      gemini:  this._db.settingGet('ai_gemini_key')  || '',
      claude:  this._db.settingGet('ai_claude_key')  || '',
      provider: this._db.settingGet('ai_provider')   || 'gemini',
    };
  }

  saveKeys({ geminiKey, claudeKey, provider, geminiModel }) {
    if (geminiKey   !== undefined) this._db.settingSet('ai_gemini_key',   geminiKey);
    if (claudeKey   !== undefined) this._db.settingSet('ai_claude_key',   claudeKey);
    if (provider    !== undefined) this._db.settingSet('ai_provider',      provider);
    if (geminiModel !== undefined) this._db.settingSet('ai_gemini_model',  geminiModel);
    return { ok: true };
  }

  // ─── Chat (general conversation) ─────────────────────────────────────────
  async chat({ messages, provider: providerOverride }) {
    const keys = this._getKeys();
    const provider = providerOverride || keys.provider;

    if (provider === 'claude') {
      return this._claudeChat(messages, keys.claude);
    }
    return this._geminiChat(messages, keys.gemini);
  }

  // ─── Script / copy generation ─────────────────────────────────────────────
  /**
   * @param {Object} opts
   * @param {string} opts.type      - 'promotional'|'follow_up'|'reminder'|'offer'|'announcement'|'custom'
   * @param {string} opts.product   - product or service name
   * @param {string} opts.audience  - target audience description
   * @param {string} opts.tone      - 'formal'|'friendly'|'urgent'|'casual'
   * @param {string} opts.language  - 'ar'|'en'|'both'
   * @param {string} [opts.extra]   - any extra context/instructions
   * @param {string} [opts.provider]
   */
  async generateScript(opts) {
    const { type, product, audience, tone, language, extra, provider: prov } = opts;
    const keys = this._getKeys();
    const provider = prov || keys.provider;

    const langLabel = language === 'ar' ? 'Arabic'
                    : language === 'en' ? 'English'
                    : 'both Arabic and English (Arabic first)';

    const typeLabel = {
      promotional:  'a promotional WhatsApp message',
      follow_up:    'a follow-up message after previous contact',
      reminder:     'a gentle reminder message',
      offer:        'a limited-time special offer message',
      announcement: 'a business announcement',
      custom:       'a custom business message',
    }[type] || 'a WhatsApp business message';

    const toneMap = {
      formal:   'professional and formal',
      friendly: 'warm and friendly',
      urgent:   'urgent and compelling',
      casual:   'casual and conversational',
    };

    const systemPrompt = `You are an expert WhatsApp Business copywriter specializing in high-conversion messages for Arabic and Middle Eastern markets. Write concise, engaging messages suitable for WhatsApp (under 500 characters when possible). Use appropriate emojis sparingly. Never use markdown formatting.`;

    const userPrompt = `Write ${typeLabel} in ${langLabel} with a ${toneMap[tone] || tone} tone.

Product/Service: ${product}
Target Audience: ${audience}
${extra ? `Additional context: ${extra}` : ''}

Requirements:
- Keep it concise and WhatsApp-friendly
- Include a clear call to action
- Use 1-2 relevant emojis maximum
- No markdown, no asterisks, no formatting symbols
- Ready to send as-is`;

    const messages = [{ role: 'user', content: userPrompt }];

    if (provider === 'claude') {
      return this._claudeChat(messages, keys.claude, systemPrompt);
    }
    return this._geminiChat(messages, keys.gemini, systemPrompt);
  }

  // ─── Generate 5 script variants ──────────────────────────────────────────
  /**
   * Generate 5 distinct message variations for A/B testing and script rotation.
   * The frontend can feed all 5 into the sending engine's scripts[] array.
   */
  async generateVariants(opts) {
    const { type, product, audience, tone, language, extra, provider: prov } = opts;
    const keys     = this._getKeys();
    const provider = prov || keys.provider;

    const langLabel = language === 'ar' ? 'Arabic'
                    : language === 'en' ? 'English'
                    : 'both Arabic and English';

    const systemPrompt = `You are an expert WhatsApp Business copywriter for Arabic and Middle Eastern markets. Write concise, engaging messages for WhatsApp (under 400 characters each). Use appropriate emojis sparingly. Never use markdown formatting. Never use asterisks or bold text.`;

    const userPrompt = `Write exactly 5 DIFFERENT versions of a ${type || 'promotional'} WhatsApp message in ${langLabel} with a ${tone || 'friendly'} tone.

Product/Service: ${product || ''}
Target Audience: ${audience || ''}
${extra ? `Additional context: ${extra}` : ''}

Requirements:
- Each version must be NOTICEABLY different (different opening, different CTA, different structure)
- Each version under 400 characters
- Include 1-2 relevant emojis per version
- No markdown, no asterisks
- Ready to send as-is
- Label each version as: [1], [2], [3], [4], [5]`;

    const messages = [{ role: 'user', content: userPrompt }];

    let raw;
    if (provider === 'claude') {
      const res = await this._claudeChat(messages, keys.claude, systemPrompt);
      raw = res.content;
    } else {
      const res = await this._geminiChat(messages, keys.gemini, systemPrompt);
      raw = res.content;
    }

    // Parse the [1]...[5] blocks from the response
    const variants = [];
    const regex = /\[(\d)\]\s*([\s\S]*?)(?=\[\d\]|$)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const text = match[2].trim();
      if (text) variants.push(text);
    }

    // Fallback: split by double newline if parser finds nothing
    if (variants.length < 2) {
      return { variants: raw.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).slice(0, 5) };
    }

    return { variants };
  }

  // ─── Reply Classification ────────────────────────────────────────────────
  async classifyReply(text) {
    const keys = this._getKeys();
    const prompt = `Classify this WhatsApp reply into ONE category. Reply with ONLY the JSON: {"intent":"interested"|"not_interested"|"question"|"complaint"|"request"|"other","confidence":0-100,"reason":"1 sentence"}\n\nMessage: "${text}"`;
    try {
      let raw;
      if (keys.provider === 'claude' && keys.claude) {
        const res = await this._claudeChat([{ role:'user', content: prompt }], keys.claude,
          'You are a message intent classifier. Always respond with valid JSON only.');
        raw = res.content;
      } else if (keys.gemini) {
        const res = await this._geminiChat([{ role:'user', content: prompt }], keys.gemini,
          'You are a message intent classifier. Always respond with valid JSON only.');
        raw = res.content;
      } else {
        return { intent: 'other', confidence: 0, reason: 'AI not configured' };
      }
      const json = raw.match(/\{[\s\S]*\}/)?.[0] || '{}';
      return JSON.parse(json);
    } catch (_) {
      return { intent: 'other', confidence: 0, reason: 'Classification failed' };
    }
  }

  // ─── Smart Reply Suggestions ─────────────────────────────────────────────
  async smartReplySuggestions({ conversation, contactName, businessContext }) {
    const keys = this._getKeys();
    const lastMsgs = (conversation || []).slice(-5).map(m =>
      `${m.dir === 'in' ? (contactName || 'العميل') : 'نحن'}: ${m.body || ''}`
    ).join('\n');
    const prompt = `Based on this WhatsApp conversation, suggest exactly 3 SHORT reply options (under 80 chars each) in Arabic.\nBusiness: ${businessContext || 'خدمات أعمال'}\nConversation:\n${lastMsgs}\n\nReply with JSON only: {"suggestions":["reply1","reply2","reply3"]}`;
    try {
      let raw;
      if (keys.provider === 'claude' && keys.claude) {
        const res = await this._claudeChat([{ role:'user', content: prompt }], keys.claude, 'You are a WhatsApp business reply assistant. Respond with valid JSON only.');
        raw = res.content;
      } else if (keys.gemini) {
        const res = await this._geminiChat([{ role:'user', content: prompt }], keys.gemini, 'You are a WhatsApp business reply assistant. Respond with valid JSON only.');
        raw = res.content;
      } else {
        return { suggestions: ['شكراً لتواصلك معنا', 'سنرد عليك قريباً', 'كيف يمكننا مساعدتك؟'] };
      }
      const json = raw.match(/\{[\s\S]*\}/)?.[0] || '{"suggestions":[]}';
      return JSON.parse(json);
    } catch (_) {
      return { suggestions: ['شكراً لتواصلك معنا', 'سنرد عليك قريباً', 'كيف يمكننا مساعدتك؟'] };
    }
  }

  // ─── Conversation Summarization ──────────────────────────────────────────
  async summarizeConversation({ messages, contactName }) {
    const keys = this._getKeys();
    const history = (messages || []).slice(-20).map(m =>
      `${m.dir === 'in' ? (contactName || 'العميل') : 'نحن'} (${(m.ts||'').slice(0,10)}): ${m.body || ''}`
    ).join('\n');
    const prompt = `Summarize this WhatsApp conversation in 3-4 sentences in Arabic. Focus on: what the customer wants, any issues raised, and the current status.\n\nConversation:\n${history}`;
    try {
      if (keys.provider === 'claude' && keys.claude) {
        return this._claudeChat([{ role:'user', content: prompt }], keys.claude, 'You are a conversation summarizer. Write concise Arabic summaries.');
      } else if (keys.gemini) {
        return this._geminiChat([{ role:'user', content: prompt }], keys.gemini, 'You are a conversation summarizer. Write concise Arabic summaries.');
      }
      return { role: 'assistant', content: 'لم يتم إعداد مزود AI بعد.' };
    } catch (_) {
      return { role: 'assistant', content: 'تعذر تلخيص المحادثة.' };
    }
  }

  // ─── Campaign Optimizer ──────────────────────────────────────────────────
  async optimizeCampaign({ sent, read_count, replies, failed, scripts }) {
    const keys = this._getKeys();
    const replyRate  = sent ? Math.round(replies/sent*100) : 0;
    const readRate   = sent ? Math.round(read_count/sent*100) : 0;
    const failRate   = sent ? Math.round(failed/sent*100) : 0;
    const prompt = `Analyze this WhatsApp campaign and provide 3 specific improvement suggestions in Arabic.\n\nCampaign Stats:\n- Sent: ${sent}\n- Read Rate: ${readRate}%\n- Reply Rate: ${replyRate}%\n- Fail Rate: ${failRate}%\n${scripts?.length ? `- Scripts used: ${scripts.length}` : ''}\n\nProvide actionable suggestions as JSON: {"analysis":"2 sentence overview","suggestions":["tip1","tip2","tip3"]}`;
    try {
      let raw;
      if (keys.provider === 'claude' && keys.claude) {
        const res = await this._claudeChat([{ role:'user', content: prompt }], keys.claude, 'You are a WhatsApp marketing expert. Always respond with valid JSON.');
        raw = res.content;
      } else if (keys.gemini) {
        const res = await this._geminiChat([{ role:'user', content: prompt }], keys.gemini, 'You are a WhatsApp marketing expert. Always respond with valid JSON.');
        raw = res.content;
      } else {
        return { analysis: 'AI غير مُهيأ', suggestions: ['أضف مفاتيح AI في الإعدادات'] };
      }
      const json = raw.match(/\{[\s\S]*\}/)?.[0] || '{}';
      return JSON.parse(json);
    } catch (_) {
      return { analysis: 'تعذر التحليل', suggestions: [] };
    }
  }

  // ─── Streaming Claude chat (yields text chunks for IPC events) ───────────
  async * streamClaudeChat(messages, systemPrompt) {
    const keys = this._getKeys();
    if (!keys.claude) { yield { type: 'error', text: 'مفتاح Claude API غير محدد' }; return; }
    const client = new Anthropic({ apiKey: keys.claude });
    const params = {
      model:    'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    };
    if (systemPrompt) params.system = systemPrompt;
    const stream = client.messages.stream(params);
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        yield { type: 'chunk', text: chunk.delta.text };
      }
    }
    yield { type: 'done' };
  }

  // ─── Gemini implementation ────────────────────────────────────────────────
  async _geminiChat(messages, apiKey, systemPrompt) {
    if (!apiKey) throw new Error('مفتاح Gemini API غير محدد — أضفه من صفحة الإعدادات ← مفاتيح AI.');

    const geminiModel = this._db.settingGet('ai_gemini_model') || 'gemini-2.0-flash';
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      systemInstruction: systemPrompt || undefined,
    });

    // Convert messages to Gemini format, ensuring alternating user/model roles
    const rawHistory = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // Fix consecutive same-role messages (Gemini requires strict alternation)
    const history = [];
    for (const msg of rawHistory) {
      if (history.length > 0 && history[history.length - 1].role === msg.role) {
        const placeholder = msg.role === 'user' ? 'model' : 'user';
        history.push({ role: placeholder, parts: [{ text: '...' }] });
      }
      history.push(msg);
    }

    const lastMsg = messages[messages.length - 1];

    try {
      const chat = model.startChat({ history });
      const result = await chat.sendMessage(lastMsg.content);
      const text = result.response.text();
      return { role: 'assistant', content: text };
    } catch (e) {
      throw new Error(this._normalizeGeminiError(e));
    }
  }

  _normalizeGeminiError(e) {
    const msg = e?.message || String(e);
    if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid'))
      return 'مفتاح Gemini API غير صالح — افتح الإعدادات ← مفاتيح AI وأدخل مفتاحاً صحيحاً من console.cloud.google.com';
    if (msg.includes('QUOTA_EXCEEDED') || msg.includes('quota') || msg.includes('429'))
      return 'تم تجاوز الحد اليومي لـ Gemini API — حاول لاحقاً أو استخدم Claude بدلاً.';
    if (msg.includes('PERMISSION_DENIED') || msg.includes('403'))
      return 'المفتاح لا يملك صلاحية Gemini API — تأكد من تفعيل Generative Language API في Google Cloud.';
    if (msg.includes('MODEL_NOT_FOUND') || msg.includes('models/') || msg.includes('404'))
      return 'النموذج المحدد غير متاح — افتح الإعدادات وغيّر نموذج Gemini إلى gemini-2.0-flash.';
    if (msg.includes('RESOURCE_EXHAUSTED'))
      return 'موارد Gemini API مستنفدة مؤقتاً — انتظر دقيقة ثم حاول مجدداً.';
    return 'خطأ في Gemini API — ' + msg.split('\n')[0].slice(0, 120);
  }

  // ─── Claude implementation ────────────────────────────────────────────────
  async _claudeChat(messages, apiKey, systemPrompt) {
    if (!apiKey) throw new Error('مفتاح Claude API غير محدد — أضفه من صفحة الإعدادات ← مفاتيح AI.');

    const client = new Anthropic({ apiKey });

    const claudeMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const params = {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages:   claudeMessages,
    };
    if (systemPrompt) params.system = systemPrompt;

    try {
      const response = await client.messages.create(params);
      const text = response.content?.[0]?.text || '';
      return { role: 'assistant', content: text };
    } catch (e) {
      throw new Error(this._normalizeClaudeError(e));
    }
  }

  _normalizeClaudeError(e) {
    const msg = e?.message || String(e);
    const status = e?.status;
    if (status === 401 || msg.includes('authentication') || msg.includes('API key'))
      return 'مفتاح Claude API غير صالح — افتح الإعدادات ← مفاتيح AI وأدخل مفتاحاً صحيحاً من console.anthropic.com';
    if (status === 429 || msg.includes('rate_limit') || msg.includes('overloaded'))
      return 'Claude مشغول حالياً — حاول بعد لحظات أو استخدم Gemini بدلاً.';
    if (status === 403)
      return 'المفتاح لا يملك صلاحية هذا النموذج — تحقق من خطة Claude API.';
    if (status === 400)
      return 'طلب غير صالح لـ Claude API — حاول مجدداً.';
    return 'خطأ في Claude API — ' + msg.split('\n')[0].slice(0, 120);
  }
}

module.exports = AiService;
