import { Schema, model } from 'mongoose';

/** API Partner model - represents a B2B partner who can use the
 * competitor‑price comparison and submission APIs.
 */
const ApiPartnerSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  apiKey: { type: String, required: true, unique: true }, // used for authentication
  apiSecret: { type: String }, // optional secret for HMAC verification
  tier: {
    type: String,
    enum: ['free', 'starter', 'pro', 'enterprise'],
    default: 'free',
  },
  monthlyRequestLimit: { type: Number, default: 1000 },
  currentMonthRequests: { type: Number, default: 0 },
  commissionRate: { type: Number, default: 0 }, // percent
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastAccessedAt: { type: Date },
  allowedOrigins: [{ type: String }],
  webhookUrl: { type: String },
}, { collection: 'api_partners' });

// Pre‑save hook to automatically set lastAccessedAt if the document is modified
ApiPartnerSchema.pre('save', function () {
  if (this.isModified()) {
    this.lastAccessedAt = new Date();
  }
});

export const ApiPartner = model('ApiPartner', ApiPartnerSchema);