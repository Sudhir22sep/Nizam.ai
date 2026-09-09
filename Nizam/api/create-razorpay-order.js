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

  const keyId = process.env.RAZORPAY_KEY_ID_LIVE || process.env.RAZORPAY_KEY_ID_TEST;
  const keySecret = process.env.RAZORPAY_KEY_SECRET_LIVE || process.env.RAZORPAY_KEY_SECRET_TEST;

  if (!keyId || !keySecret) {
    return res.status(500).json({ success: false, message: 'Razorpay is not configured.' });
  }

  const orderReference = `ORDER-${Date.now()}`;

  // Exchange rates relative to USD (1 USD = X target) - must match CurrencyService
  const exchangeRates = {
    USD: 1,
    INR: 95.21,
    AED: 3.67,
    SAR: 3.73
  };

  // Supported currencies - Razorpay only accepts INR for Indian accounts
  const supportedCurrencies = ['USD', 'INR', 'AED', 'SAR'];
  
  // Validate and normalize currency - default to USD (base currency for products)
  // The frontend should always send a valid currency, but we guard against missing/invalid values
  const frontendCurrency = supportedCurrencies.includes(currency) ? currency : 'USD';
  
  const frontendRate = exchangeRates[frontendCurrency] ?? 1;
  const inrRate = exchangeRates['INR'] ?? 95.21;

  // Convert: total (in frontend currency) -> USD -> INR
  // This ensures Razorpay ALWAYS receives the correct INR amount regardless of frontend currency
  const totalInUsd = total / frontendRate;
  const totalInInr = totalInUsd * inrRate;
  
  // Safety check: if the converted INR amount seems unreasonably low or high, log a warning
  // For a typical cart, INR amount should be between ₹1 and ₹10,00,000 (adjust as needed)
  if (totalInInr < 1 || totalInInr > 1000000) {
    console.warn(`[Razorpay] WARNING: Unusual INR amount detected: ₹${totalInInr.toFixed(2)} (frontend: ${frontendCurrency} ${total})`);
  }

  // Convert to paise (smallest unit for INR)
  const amountInPaise = Math.round(totalInInr * 100);

  console.log(`[Razorpay] Frontend currency: ${frontendCurrency}, Total: ${total}, USD: ${totalInUsd.toFixed(2)}, INR: ${totalInInr.toFixed(2)}, Paise: ${amountInPaise}`);

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: orderReference,
      payment_capture: true,
      notes: {
        originalCurrency: frontendCurrency,
        originalAmount: total,
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
