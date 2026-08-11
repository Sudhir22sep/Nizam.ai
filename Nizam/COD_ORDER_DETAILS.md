# COD Order Details - Where to Find Orders

## Order Storage Location

**COD orders are stored in MongoDB** in the **`orders` collection** with these fields:

```javascript
{
  orderReference: "ORDER-1722000000000",  // Unique ID: ORDER-{timestamp}
  name: "Customer Name",
  email: "customer@email.com",
  address: "Delivery address",
  items: [...],                           // Array of ordered products
  total: 150.00,                          // Order total
  currency: "USD",                        // or INR, AED, SAR
  paymentMethod: "COD",                   // Always "COD" for cash on delivery
  status: "pending",                      // Initial status
  createdAt: ISODate("2024-07-26T...")    // Timestamp
}
```

## How to Find/Access Orders

### 1. MongoDB Atlas / Compass / Shell

```bash
# Connect to MongoDB
mongosh "mongodb+srv://<cluster>.mongodb.net/nizam_ai" --username <user>

# Find all COD orders
use nizam_ai
db.orders.find({ paymentMethod: "COD" }).sort({ createdAt: -1 })

# Find by order reference
db.orders.findOne({ orderReference: "ORDER-1722000000000" })

# Find by customer email
db.orders.find({ email: "customer@email.com" }).sort({ createdAt: -1 })

# Find pending orders
db.orders.find({ status: "pending" }).sort({ createdAt: -1 })

# Count COD orders
db.orders.countDocuments({ paymentMethod: "COD" })
```

### 2. API Endpoints (Need to Add)

Currently there's **no API endpoint** to retrieve orders. Add this to `src/server.ts`:

```typescript
// GET /api/orders - Get all orders (with pagination)
app.get('/api/orders', async (req, res) => {
  try {
    const ordersCollection = await getOrdersCollection();
    const { email, status, paymentMethod, page = 1, limit = 20 } = req.query;
    
    const filter: any = {};
    if (email) filter.email = email;
    if (status) filter.status = status;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    
    const orders = await ordersCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .toArray();
    
    const total = await ordersCollection.countDocuments(filter);
    
    res.json({ orders, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('get orders error', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// GET /api/orders/:orderReference - Get single order
app.get('/api/orders/:orderReference', async (req, res) => {
  try {
    const ordersCollection = await getOrdersCollection();
    const order = await ordersCollection.findOne({ 
      orderReference: req.params.orderReference 
    });
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    res.json({ success: true, order });
  } catch (err) {
    console.error('get order error', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// PATCH /api/orders/:orderReference/status - Update order status
app.patch('/api/orders/:orderReference/status', async (req, res) => {
  try {
    const ordersCollection = await getOrdersCollection();
    const { status } = req.body;
    
    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const result = await ordersCollection.updateOne(
      { orderReference: req.params.orderReference },
      { $set: { status, updatedAt: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    
    res.json({ success: true, message: 'Order status updated' });
  } catch (err) {
    console.error('update order status error', err);
    res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});
```

### 3. Email Confirmation

When COD order is placed, an email is sent to the customer with:
- Order reference number
- Items ordered
- Total amount
- Delivery address
- Payment method: "Cash on Delivery"

### 4. Admin Dashboard (Future Enhancement)

Create an admin page in Angular to view/manage orders:
- List all orders with filters (status, date, payment method)
- View order details
- Update status: `pending` → `confirmed` → `shipped` → `delivered`
- Export orders to CSV

## Order Flow

1. Customer places COD order via checkout page
2. Backend creates order in `orders` collection with `status: "pending"`
3. Backend sends confirmation email to customer
4. Response returns `orderReference` (e.g., `ORDER-1722000000000`)
5. Admin views order in MongoDB or admin dashboard
6. Admin updates status as order progresses
7. Order delivered → status: `delivered`

## Quick Test Commands

```bash
# Place a test COD order
curl -X POST https://your-app.onrender.com/api/create-cod-order \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "address": "123 Test St, City",
    "items": [{"id": 1, "name": "Product", "price": 50, "quantity": 1}],
    "total": 50,
    "currency": "USD"
  }'

# Get all orders (after adding endpoint)
curl https://your-app.onrender.com/api/orders

# Get specific order
curl https://your-app.onrender.com/api/orders/ORDER-1722000000000

# Update order status
curl -X PATCH https://your-app.onrender.com/api/orders/ORDER-1722000000000/status \
  -H "Content-Type: application/json" \
  -d '{"status": "shipped"}'
```

## Deployment Checklist

- [ ] Add order retrieval endpoints to `src/server.ts`
- [ ] Set `MONGODB_URI` in Render environment variables
- [ ] Set `SES_REGION` and `SES_VERIFIED_SENDER` for emails
- [ ] Run `npm run build` 
- [ ] Deploy to Render
- [ ] Test COD order flow end-to-end