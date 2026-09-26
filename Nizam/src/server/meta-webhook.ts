import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Helpers for the Meta (WhatsApp Cloud API) webhook that is mounted on `POST /`.
 *
 * Everything here is pure so the payload handling can be unit tested without a
 * running Express app or MongoDB. See `server.ts` for the HTTP wiring.
 */

/** A single inbound customer message, flattened out of Meta's nested payload. */
export interface MetaInboundMessage {
  /** Meta's `wamid...` id. Doubles as the de-duplication key (Meta retries). */
  messageId: string;
  /** Customer's WhatsApp id (`wa_id`), e.g. `919876543210`. */
  from: string;
  /** Customer's WhatsApp display name, when Meta supplies it. */
  profileName: string;
  /** Unix seconds from Meta, or null when missing/unparseable. */
  timestamp: number | null;
  /** `text`, `image`, `interactive`, `status`, ... */
  type: string;
  /** Best-effort human readable body. Empty for payloads we cannot render. */
  text: string;
  /** True when the message carries an image/video/audio/document attachment. */
  hasMedia: boolean;
  /** WhatsApp Business Account (WABA) id the event arrived through. */
  pageId: string;
  /** Business phone number id the customer wrote to. */
  phoneNumberId: string;
}

const MAX_PROFILE_NAME = 120;
const MAX_TEXT = 2000;
/** Meta can batch many entries/changes/messages into a single delivery. */
const MAX_MESSAGES_PER_DELIVERY = 50;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asTrimmedString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // Drop C0/C1 control characters so a crafted payload cannot inject content
  // into the admin notification email or the stored document.
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function asIdString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  // Ids are opaque tokens; only strip characters that break storage/HTML.
  return value.replace(/[^\w.:@+-]/g, '').trim().slice(0, maxLength);
}


/**
 * Renders a readable summary for the many message shapes Meta can deliver.
 * Unknown shapes intentionally fall back to '' rather than dumping raw JSON
 * into an admin inbox.
 */
function extractText(message: Record<string, unknown>): { text: string; hasMedia: boolean } {
  switch (message['type']) {
    case 'text': {
      const text = asRecord(message['text']);
      return { text: asTrimmedString(text?.['body'], MAX_TEXT), hasMedia: false };
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const node = asRecord(message[message['type'] as string]);
      const caption = asTrimmedString(node?.['caption'], MAX_TEXT);
      return { text: caption, hasMedia: true };
    }
    case 'button': {
      const button = asRecord(message['button']);
      return { text: asTrimmedString(button?.['text'], MAX_TEXT), hasMedia: false };
    }
    case 'interactive': {
      const interactive = asRecord(message['interactive']);
      const reply =
        asRecord(interactive?.['button_reply']) ?? asRecord(interactive?.['list_reply']);
      if (!reply) return { text: '', hasMedia: false };
      const title = asTrimmedString(reply['title'], MAX_TEXT);
      const id = asTrimmedString(reply['id'], MAX_TEXT);
      return { text: id && id !== title ? `${title} (${id})` : title, hasMedia: false };
    }
    case 'location': {
      const location = asRecord(message['location']);
      const latitude = Number(location?.['latitude']);
      const longitude = Number(location?.['longitude']);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return { text: '', hasMedia: false };
      }
      return { text: `Location: ${latitude}, ${longitude}`, hasMedia: false };
    }
    case 'contacts': {
      const contacts = asArray(message['contacts']);
      const name = asRecord(asRecord(contacts[0])?.['name']);
      return { text: asTrimmedString(name?.['formatted_name'], MAX_TEXT), hasMedia: false };
    }
    case 'order': {
      const order = asRecord(message['order']);
      return { text: asTrimmedString(order?.['order_status'], MAX_TEXT), hasMedia: false };
    }
    case 'reaction': {
      const reaction = asRecord(message['reaction']);
      return { text: asTrimmedString(reaction?.['emoji'], MAX_TEXT), hasMedia: false };
    }
    case 'unsupported':
      return { text: 'Unsupported message type', hasMedia: true };
    default:
      return { text: '', hasMedia: false };
  }
}


/**
 * Flattens Meta's `object → entry[] → changes[] → value` envelope into a list
 * of inbound customer messages.
 *
 * Deliberately total: any malformed or unexpected shape yields fewer messages
 * rather than throwing, because a throw would make Meta retry the same payload.
 * Status/read receipts carry no customer text and are skipped.
 */
export function parseInboundMessages(payload: unknown): MetaInboundMessage[] {
  const body = asRecord(payload);
  if (!body) return [];

  const messages: MetaInboundMessage[] = [];

  for (const entry of asArray(body['entry'])) {
    const entryRecord = asRecord(entry);
    const pageId = asIdString(entryRecord?.['id'], 64);

    for (const change of asArray(entryRecord?.['changes'])) {
      const changeRecord = asRecord(change);
      const field = changeRecord?.['field'];
      if (field !== undefined && field !== 'messages') continue;

      const value = asRecord(changeRecord?.['value']);
      if (!value) continue;

      const metadata = asRecord(value['metadata']);
      const phoneNumberId = asIdString(metadata?.['phone_number_id'], 64);
      const contacts = asArray(value['contacts']).map(asRecord);

      for (const rawMessage of asArray(value['messages'])) {
        if (messages.length >= MAX_MESSAGES_PER_DELIVERY) return messages;

        const message = asRecord(rawMessage);
        if (!message) continue;

        const from = asIdString(message['from'], 64);
        const messageId = asIdString(message['id'], 128);
        // Without an id we cannot de-duplicate Meta's retries, so drop it.
        if (!from || !messageId) continue;

        const { text, hasMedia } = extractText(message);
        const rawTimestamp = Number(message['timestamp']);
        const contact = contacts.find(
          (candidate) => candidate && asIdString(candidate['wa_id'], 64) === from
        );

        messages.push({
          messageId,
          from,
          profileName: asTrimmedString(
            asRecord(contact?.['profile'])?.['name'],
            MAX_PROFILE_NAME
          ),
          timestamp: Number.isFinite(rawTimestamp) ? Math.trunc(rawTimestamp) : null,
          type: asTrimmedString(message['type'], 40) || 'unknown',
          text,
          hasMedia,
          pageId,
          phoneNumberId,
        });
      }
    }
  }

  return messages;
}

/**
 * Verifies Meta's `X-Hub-Signature-256` header (`sha256=<hex>`) against the
 * raw request body using the app secret.
 *
 * Returns false when the secret is unset so a misconfigured deployment fails
 * closed (403) rather than silently trusting unsigned payloads.
 */
export function verifyMetaSignature(
  rawBody: Buffer | string,
  header: string | undefined | null,
  appSecret: string | undefined | null
): boolean {
  if (!appSecret) return false;
  if (!header || !header.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = header.slice('sha256='.length).toLowerCase();
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}

/** Email the store owner when a new WhatsApp message arrives. */
export function buildInboundMessageEmail(message: MetaInboundMessage): {
  subject: string;
  text: string;
  html: string;
} {
  const who = message.profileName ? `${message.profileName} (${message.from})` : message.from;
  const received = message.timestamp
    ? new Date(message.timestamp * 1000).toISOString()
    : 'unknown time';

  // Escape before interpolating: this content comes from an untrusted sender
  // and would otherwise be able to inject HTML into the admin's inbox.
  const safeWho = escapeHtml(who);
  const safeBody = escapeHtml(message.text || '(no readable text)');

  return {
    subject: `New WhatsApp message from ${who}`,
    text: [
      'New inbound WhatsApp message',
      '',
      `From: ${who}`,
      `Phone: ${message.from}`,
      `Received: ${received}`,
      `Type: ${message.type}`,
      `Message id: ${message.messageId}`,
      '',
      'Message:',
      message.text || '(no readable text)',
    ].join('\n'),
    html: [
      `<p><strong>From:</strong> ${safeWho}</p>`,
      `<p><strong>Phone:</strong> ${escapeHtml(message.from)}</p>`,
      `<p><strong>Type:</strong> ${escapeHtml(message.type)}</p>`,
      `<p><strong>Received:</strong> ${escapeHtml(received)}</p>`,
      `<p><strong>Message id:</strong> ${escapeHtml(message.messageId)}</p>`,
      '<p><strong>Message:</strong></p>',
      `<p>${safeBody}</p>`,
    ].join('\n'),
  };
}
