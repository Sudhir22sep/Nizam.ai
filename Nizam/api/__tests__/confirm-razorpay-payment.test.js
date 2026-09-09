const crypto = require('crypto');

const confirmRazorpayPayment = require('../confirm-razorpay-payment');

describe('confirm-razorpay-payment', () => {
  const mockReq = (body) => ({
    method: 'POST',
    body,
  });

  const mockRes = () => {
    const res = {};
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.data = data;
      return res;
    };
    res.setHeader = () => {};
    return res;
  };

  beforeEach(() => {
    // Reset process.env - must match the variable names in confirm-razorpay-payment.js
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    process.env.RAZORPAY_TEST_KEY_SECRET = undefined;
    process.env.RAZORPAY_KEY_SECRET_LIVE = undefined;
  });

  it('should return 405 if method is not POST', async () => {
    const req = mockReq({});
    req.method = 'GET';
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Method not allowed.');
  });

  it('should return 400 if missing orderReference', async () => {
    const req = mockReq({
      razorpayPaymentId: 'pay_123',
      razorpayOrderId: 'order_123',
      razorpaySignature: 'sig_123',
    });
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Payment verification parameters are required.');
  });

  it('should return 400 if missing razorpayPaymentId', async () => {
    const req = mockReq({
      orderReference: 'order_ref_123',
      razorpayOrderId: 'order_123',
      razorpaySignature: 'sig_123',
    });
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Payment verification parameters are required.');
  });

  it('should return 400 if missing razorpayOrderId', async () => {
    const req = mockReq({
      orderReference: 'order_ref_123',
      razorpayPaymentId: 'pay_123',
      razorpaySignature: 'sig_123',
    });
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Payment verification parameters are required.');
  });

  it('should return 400 if missing razorpaySignature', async () => {
    const req = mockReq({
      orderReference: 'order_ref_123',
      razorpayPaymentId: 'pay_123',
      razorpayOrderId: 'order_123',
    });
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Payment verification parameters are required.');
  });

  it('should return 500 if Razorpay is not configured', async () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_TEST_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_SECRET_LIVE;

    const req = mockReq({
      orderReference: 'order_ref_123',
      razorpayPaymentId: 'pay_123',
      razorpayOrderId: 'order_123',
      razorpaySignature: 'sig_123',
    });
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Razorpay is not configured.');
  });

  it('should return 400 if signature is invalid', async () => {
    const req = mockReq({
      orderReference: 'order_ref_123',
      razorpayPaymentId: 'pay_123',
      razorpayOrderId: 'order_123',
      razorpaySignature: 'invalid_signature',
    });
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.message).toBe('Invalid payment signature.');
  });

  it('should return 200 if signature is valid', async () => {
    const keySecret = 'test_secret';
    const orderId = 'order_123';
    const paymentId = 'pay_123';
    const signature = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const req = mockReq({
      orderReference: 'order_ref_123',
      razorpayPaymentId: paymentId,
      razorpayOrderId: orderId,
      razorpaySignature: signature,
    });
    const res = mockRes();

    await confirmRazorpayPayment(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.orderReference).toBe('order_ref_123');
  });
});