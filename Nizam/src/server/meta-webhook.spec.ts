import { createHmac } from 'crypto';
import {
  buildInboundMessageEmail,
  parseInboundMessages,
  verifyMetaSignature,
  type MetaInboundMessage,
} from './meta-webhook';

function textPayload(extra?: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: 'PNID_1' },
              contacts: [{ profile: { name: 'Asha' }, wa_id: '919876543210' }],
              messages: [
                {
                  from: '919876543210',
                  id: 'wamid.OUT1',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Do you have this in size M?' },
                },
                ...(extra ? [extra] : []),
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('Meta webhook payload parsing', () => {
  it('flattens a standard text message and attaches the sender profile', () => {
    const [message] = parseInboundMessages(textPayload());

    expect(message).toMatchObject({
      messageId: 'wamid.OUT1',
      from: '919876543210',
      profileName: 'Asha',
      timestamp: 1700000000,
      type: 'text',
      text: 'Do you have this in size M?',
      hasMedia: false,
      pageId: 'WABA_1',
      phoneNumberId: 'PNID_1',
    });
  });

  it('returns an empty list for malformed payloads instead of throwing', () => {
    expect(parseInboundMessages(null)).toEqual([]);
    expect(parseInboundMessages('nope')).toEqual([]);
    expect(parseInboundMessages({})).toEqual([]);
    expect(parseInboundMessages({ entry: 'not-an-array' })).toEqual([]);
    expect(parseInboundMessages({ entry: [{ changes: [{ value: null }] }] })).toEqual([]);
  });

  it('ignores read receipts and non-message fields', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_1',
          changes: [
            { field: 'messages', value: { statuses: [{ id: 'wamid.OUT1', status: 'read' }] } },
          ],
        },
      ],
    };
    expect(parseInboundMessages(payload)).toEqual([]);

    expect(
      parseInboundMessages({
        entry: [{ id: 'WABA_1', changes: [{ field: 'other', value: { messages: [] } }] }],
      })
    ).toEqual([]);
  });

  it('drops messages that cannot be de-duplicated (no id) or addressed (no sender)', () => {
    const messages = parseInboundMessages({
      entry: [
        {
          id: 'WABA_1',
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  { from: '919876543210', type: 'text', text: { body: 'no id' } },
                  { id: 'wamid.X', type: 'text', text: { body: 'no from' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(messages).toEqual([]);
  });

  it('renders media captions, button taps and interactive replies', () => {
    const media = parseInboundMessages(
      textPayload({
        from: '919876543210',
        id: 'wamid.M1',
        timestamp: '1700000001',
        type: 'image',
        image: { caption: 'Is this the blue one?' },
      })
    );
    expect(media[1]).toMatchObject({ text: 'Is this the blue one?', hasMedia: true });

    const button = parseInboundMessages(
      textPayload({
        from: '919876543210',
        id: 'wamid.B1',
        type: 'button',
        button: { text: 'Track order' },
      })
    );
    expect(button[1]).toMatchObject({ text: 'Track order', hasMedia: false });

    const reply = parseInboundMessages(
      textPayload({
        from: '919876543210',
        id: 'wamid.I1',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'track', title: 'Track my order' },
        },
      })
    );
    expect(reply[1].text).toBe('Track my order (track)');
  });

  it('strips control characters so a payload cannot forge admin email content', () => {
    const messages = parseInboundMessages(
      textPayload({
        from: '919876543210',
        id: 'wamid.C1',
        type: 'text',
        text: { body: 'hello\u0000\u0007 world' },
      })
    );
    expect(messages[1].text).toBe('hello world');
  });

  it('caps the number of messages processed in a single delivery', () => {
    const many = Array.from({ length: 120 }, (_unused, index) => ({
      from: '919876543210',
      id: `wamid.${index}`,
      type: 'text',
      text: { body: `m${index}` },
    }));
    const messages = parseInboundMessages({
      entry: [{ id: 'WABA_1', changes: [{ field: 'messages', value: { messages: many } }] }],
    });
    expect(messages).toHaveLength(50);
  });
});

describe('Meta signature verification', () => {
  const secret = 'test-app-secret';
  const body = Buffer.from(JSON.stringify(textPayload()), 'utf8');
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a correct signature and rejects tampering', () => {
    expect(verifyMetaSignature(body, signature, secret)).toBe(true);
    expect(verifyMetaSignature(Buffer.from('{}'), signature, secret)).toBe(false);
  });

  it('rejects missing, malformed or wrong-secret signatures', () => {
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(body, 'nope', secret)).toBe(false);
    expect(verifyMetaSignature(body, signature, 'other-secret')).toBe(false);
  });

  it('fails closed when the app secret is not configured', () => {
    expect(verifyMetaSignature(body, signature, undefined)).toBe(false);
    expect(verifyMetaSignature(body, signature, '')).toBe(false);
  });
});

describe('Meta inbound message email', () => {
  const message: MetaInboundMessage = {
    messageId: 'wamid.OUT1',
    from: '919876543210',
    profileName: 'Asha',
    timestamp: 1700000000,
    type: 'text',
    text: 'Do you have this in size M?',
    hasMedia: false,
    pageId: 'WABA_1',
    phoneNumberId: 'PNID_1',
  };

  it('summarises the sender and the message', () => {
    const mail = buildInboundMessageEmail(message);
    expect(mail.subject).toBe('New WhatsApp message from Asha (919876543210)');
    expect(mail.text).toContain('Do you have this in size M?');
    expect(mail.text).toContain('wamid.OUT1');
  });

  it('escapes HTML in untrusted sender content', () => {
    const mail = buildInboundMessageEmail({
      ...message,
      profileName: '<img src=x onerror=alert(1)>',
      text: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('onerror=alert(1)>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
