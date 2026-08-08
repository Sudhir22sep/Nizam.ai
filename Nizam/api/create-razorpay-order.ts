// api/create-razorpay-order.ts
// Razorpay order creation handler

import Razorpay from 'razorpay';

// Get Razorpay keys from environment variables
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

// Initialize Razorpay client
const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret
});

/**
 * Create a Razorpay order
 * @param amount - Amount in currency units (will be converted to paise for INR)
 * @param currency - Currency code (default: INR)
 * @param receipt - Optional receipt ID
 * @param notes - Optional notes for the order
 * @returns Promise resolving to Razorpay order details
 */
export async function createRazorpayOrder(
  amount: number, 
  currency: string = 'INR',
  receipt?: string,
  notes?: Record<string, any>
) {
  try {
    // Validate environment variables
    if (!razorpayKeyId || !razorpayKeySecret) {
      throw new Error('Razorpay credentials not configured');
    }

    const orderOptions = {
      amount: amount * 100, // Convert to smallest currency unit (paise for INR)
      currency,
      receipt: receipt || `receipt_${Date.now()}`,
      notes: notes || {}
    };

    const order = await razorpay.orders.create(orderOptions);
    
    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      createdAt: order.created_at
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Razorpay order creation failed:', error);
    throw new Error(`Failed to create Razorpay order: ${errorMessage}`);
  }
}
