export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  messages: AssistantChatMessage[];
}

export interface AssistantReply {
  success: boolean;
  message: string;
  source: 'gemini' | 'local';
}

export const ASSISTANT_SYSTEM_PROMPT = `You are Amma, the customer care and styling assistant for Amma Wears, a premium everyday fashion store.

Your role:
- Help customers with styling, outfit ideas, fabric guidance, sizing questions, product discovery, gifting, shipping, returns, COD, and general order guidance.
- Be warm, concise, practical, and premium. Prefer 2-4 short paragraphs or a compact bulleted list.
- Never invent product names, prices, availability, delivery dates, policies, or order status.
- Never ask for or accept passwords, card numbers, CVV, OTPs, or full payment details.
- Do not ask for an email address, phone number, or order reference in chat.
- For a live order lookup, tell the customer to sign in and open My Orders.
- For unresolved issues, recommend the Contact page and the email ammacollectivewear@gmail.com.
- Never claim to cancel, refund, return, or modify an order.`;

const MAX_MESSAGE_LENGTH = 600;
const MAX_MESSAGES = 10;

export function sanitizeAssistantRequest(value: unknown): AssistantChatMessage[] {
  if (!value || typeof value !== 'object') return [];
  const messages = (value as AssistantRequest).messages;
  if (!Array.isArray(messages)) return [];

  return messages
    .slice(-MAX_MESSAGES)
    .filter((message): message is AssistantChatMessage =>
      !!message && (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' && message.content.trim().length > 0
    )
    .map(message => ({
      role: message.role,
      content: message.content.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH)
    }));
}

export function buildGeminiPrompt(messages: AssistantChatMessage[]): string {
  const conversation = messages
    .map(message => `${message.role === 'user' ? 'Customer' : 'Assistant'}: ${message.content}`)
    .join('\n');
  return `${ASSISTANT_SYSTEM_PROMPT}\n\nConversation:\n${conversation}\n\nAssistant:`;
}

export function localAssistantReply(message: string): string {
  const query = message.toLowerCase();

  if (/\b(order|tracking|delivery|shipment|where.*order)\b/.test(query)) {
    return 'I can help with general order questions. For live tracking or the latest status, please sign in and open **My Orders**. The page shows your current payment, fulfilment, and delivery status. I can explain shipping, COD, returns, and what to expect next, but I cannot access private order details here.';
  }
  if (/\b(return|refund|exchange|seven|7 day)\b/.test(query)) {
    return 'For eligible unused items with their original tags and packaging, request a return within **7 days of delivery**. Contact our team with your order reference and the item details so they can confirm eligibility and the next step. Refunds are issued to the original payment method after the item is received and checked.';
  }
  if (/\b(shipping|delivery|cod|cash on delivery|international)\b/.test(query)) {
    return 'Standard delivery timelines and exact charges can vary by destination and order. **COD is available on selected locations** and is shown during checkout when eligible. International card payments are processed in USD. For a precise delivery estimate, contact us with your postcode or country—do not share payment details.';
  }
  if (/\b(size|fit|sizing)\b/.test(query)) {
    return 'Fit depends on the cut and fabric. For a relaxed look, choose your usual size; for a closer silhouette, consider sizing down. Product pages may include specific fit notes. If you are between sizes, tell me the garment type and how you prefer it to fit, and I can give general styling guidance.';
  }
  if (/\b(style|styling|outfit|wedding|office|casual|occasion|gift)\b/.test(query)) {
    return 'A reliable formula is: **one base layer, one structured layer, and one finishing piece**. For work, pair a breathable shirt or knit with tailored trousers and a structured layer. For evenings, add satin, texture, or a defined accessory. Tell me the occasion, weather, and how you like to dress, and I’ll build a more specific look.';
  }
  if (/\b(price|cost|discount|sale|available|stock)\b/.test(query)) {
    return 'Prices and availability can change, so please use the **Shop** or product page for the current figure. I can help with styling or explain your cart and checkout, but I do not want to give you an outdated price or claim an item is in stock.';
  }
  return 'I can help with styling, sizing, products, shipping, COD, returns, and general order guidance. For live order tracking, please sign in and open **My Orders**. If you need help with a specific issue, use the Contact page or email ammacollectivewear@gmail.com.';
}

