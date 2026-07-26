const Razorpay = require('razorpay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const { name, email, address, items, total, currency } = body;

  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const keyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ success: false, message: 'Razorpay is not configured.' });
  }

  const orderReference = `ORDER-${Date.now()}`;
  const amountInPaise = Math.round(total * 100);

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: orderReference,
      payment_capture: true,
      notes: {
        orderReference,
        email,
        name,
      },
    });

    return res.status(200).json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId,
      orderReference,
    });
  } catch (error) {
    console.error('create-razorpay-order error', error);
    return res.status(500).json({ success: false, message: 'Unable to create Razorpay order.' });
  }
};
