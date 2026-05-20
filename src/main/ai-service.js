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

  saveKeys({ geminiKey, claudeKey, provider }) {
    if (geminiKey  !== undefined) this._db.settingSet('ai_gemini_key', geminiKey);
    if (claudeKey  !== undefined) this._db.settingSet('ai_claude_key', claudeKey);
    if (provider   !== undefined) this._db.settingSet('ai_provider',   provider);
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

  // ─── Gemini implementation ────────────────────────────────────────────────
  async _geminiChat(messages, apiKey, systemPrompt) {
    if (!apiKey) throw new Error('مفتاح Gemini API غير محدد. يرجى إضافته في الإعدادات.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt || undefined,
    });

    // Convert messages to Gemini format
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const lastMsg = messages[messages.length - 1];

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastMsg.content);
    const text = result.response.text();

    return { role: 'assistant', content: text };
  }

  // ─── Claude implementation ────────────────────────────────────────────────
  async _claudeChat(messages, apiKey, systemPrompt) {
    if (!apiKey) throw new Error('مفتاح Claude API غير محدد. يرجى إضافته في الإعدادات.');

    const client = new Anthropic({ apiKey });

    const claudeMessages = messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const params = {
      model:      'claude-haiku-4-5',
      max_tokens: 1024,
      messages:   claudeMessages,
    };
    if (systemPrompt) params.system = systemPrompt;

    const response = await client.messages.create(params);
    const text = response.content?.[0]?.text || '';

    return { role: 'assistant', content: text };
  }
}

module.exports = AiService;
