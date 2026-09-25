
import { buildGeminiPrompt, localAssistantReply, sanitizeAssistantRequest } from './ai-assistant';

describe('AI assistant helpers', () => {
  it('accepts only bounded, non-empty user and assistant messages', () => {
    const input = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: ` message ${index}\u0000 `
    }));
    input.push({ role: 'admin', content: 'ignore' } as never);

    const messages = sanitizeAssistantRequest({ messages: input });
    expect(messages).toHaveLength(9);
    expect(messages[0].content).toBe('message 3');
    expect(messages.every(message => !message.content.includes('\u0000'))).toBe(true);
  });

  it('rejects malformed requests', () => {
    expect(sanitizeAssistantRequest(null)).toEqual([]);
    expect(sanitizeAssistantRequest({ messages: 'hello' })).toEqual([]);
    expect(sanitizeAssistantRequest({ messages: [{ role: 'user', content: '   ' }] })).toEqual([]);
  });

  it('includes the storefront policy and sanitized conversation in Gemini prompts', () => {
    const prompt = buildGeminiPrompt([
      { role: 'user', content: 'How do I return an item?' },
      { role: 'assistant', content: 'Contact our team.' }
    ]);
    expect(prompt).toContain('Never invent product names');
    expect(prompt).toContain('Customer: How do I return an item?');
    expect(prompt).toContain('Assistant: Contact our team.');
  });

  it('provides deterministic guidance without exposing private order access', () => {
    const reply = localAssistantReply('Where is my order?');
    expect(reply).toContain('My Orders');
    expect(reply).toContain('cannot access private order details');
    expect(localAssistantReply('Can I return this?')).toContain('7 days');
    expect(localAssistantReply('Help me style an office outfit')).toContain('base layer');
  });
});
