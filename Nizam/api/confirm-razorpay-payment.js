const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed.' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const { orderReference, razorpayPaymentId, razorpayOrderId, razorpaySignature } = body;

  if (!orderReference || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Payment verification parameters are required.' });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET_LIVE || process.env.RAZORPAY_KEY_SECRET_TEST;
  if (!keySecret) {
    return res.status(500).json({ success: false, message: 'Razorpay is not configured.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
  }

  return res.status(200).json({ success: true, orderReference });
};
