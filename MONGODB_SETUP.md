# MongoDB Setup Guide for Nizam.ai

## 1. Create a MongoDB Atlas Account

### Step 1: Sign Up
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Click **Sign Up**
3. Create an account (email or Google)

### Step 2: Create a Free Cluster
1. After signing in, click **+ Create** → **Database**
2. Choose **M0 Sandbox** (Free tier)
3. Select your preferred cloud provider (AWS recommended)
4. Select region (closer to your users = better performance)
5. Click **Create Cluster** (takes ~5 minutes)

### Step 3: Create Database User
1. Go to **Security** → **Database Access**
2. Click **+ Add New Database User**
3. Choose **Password** authentication
4. Username: `nizamuser`
5. Password: Generate a strong password (save it!)
6. Click **Add User**

### Step 4: Allow Network Access
1. Go to **Security** → **Network Access**
2. Click **+ Add IP Address**
3. Click **Allow Access from Anywhere** (or add specific IPs)
4. Click **Confirm**

### Step 5: Get Connection String
1. Go to **Databases** → Your cluster
2. Click **Connect**
3. Choose **Drivers**
4. Select **Node.js** version 4.1 or later
5. Copy the connection string
6. Replace `<password>` with your database user password
7. Replace `myFirstDatabase` with `nizam_ai`

**Example:**
```
mongodb+srv://nizamuser:YOUR_PASSWORD@cluster0.abc123.mongodb.net/nizam_ai?retryWrites=true&w=majority
```

---

## 2. Deploy to Vercel (Free Tier)

Vercel is perfect for running your Angular SSR app with backend services.

### Step 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Step 2: Deploy from Your Project
```bash
cd /workspaces/Nizam.ai
vercel
```

### Step 3: Configure Deployment
When prompted:
- **Project name:** nizam-ai
- **Framework:** Other
- **Build command:** `cd Nizam && npm run build`
- **Output directory:** `Nizam/dist/Nizam/browser`

### Step 4: Add Environment Variables
After first deployment, go to Vercel Dashboard:
1. Your project → **Settings** → **Environment Variables**
2. Add these variables:

| Key | Value |
|-----|-------|
| `MONGODB_URI` | Your connection string from Step 1 |
| `STRIPE_SECRET_KEY` | (Optional) Your Stripe secret key |
| `SES_REGION` | (Optional) `us-east-1` |
| `SES_VERIFIED_SENDER` | (Optional) Your AWS SES verified email |
| `APP_URL` | `https://your-vercel-domain.vercel.app` |

### Step 5: Redeploy with Environment Variables
```bash
vercel --prod
```

---

## 3. Connect Custom Domain (ammawears.com)

### Option A: Use Vercel's Domain Management
1. Vercel Dashboard → Your Project → **Settings** → **Domains**
2. Click **Add Domain**
3. Enter `ammawears.com`
4. Click **Add**
5. Vercel shows DNS records to add

### Option B: Manual DNS Configuration (GoDaddy)
1. In GoDaddy DNS Manager, add Vercel's DNS records:
   - **CNAME** record for www: `cname.vercel-dns.com`
   - Or use A records (Vercel provides these)

2. In Vercel, verify the domain

3. Enable HTTPS (automatic)

---

## 4. Test Your Deployment

### After Vercel Deployment:
```bash
# Test API endpoints
curl https://your-vercel-domain.vercel.app/api/contact \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John",
    "email": "john@example.com",
    "message": "Test message"
  }'

# Should return: {"success": true, "message": "..."}
```

### Check MongoDB:
1. MongoDB Atlas Dashboard
2. **Collections** → `nizam_ai` database
3. You should see collections: `orders`, `users`, `contacts`
4. Click and view stored data

---

## 5. Local Development with MongoDB

### Option 1: Use MongoDB Atlas (Remote)
Simply use your `MONGODB_URI` in `.env` locally:
```
MONGODB_URI=mongodb+srv://nizamuser:PASSWORD@cluster0.abc123.mongodb.net/nizam_ai?retryWrites=true&w=majority
```

### Option 2: Run MongoDB Locally
```bash
# Install Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest

# Or use local MongoDB
mongod
```

Then use:
```
MONGODB_URI=mongodb://localhost:27017/nizam_ai
```

### Start Development Server
```bash
cd Nizam
cp ../.env.example .env.local
# Edit .env.local with your MONGODB_URI

npm run build
node dist/Nizam/server/server.mjs
```

Server runs on `http://localhost:4000`

---

## 6. Manage Your Data

### View Collections in MongoDB Atlas
1. Go to **Collections** in your cluster
2. Click on collection name
3. View, edit, or delete documents

### Query Your Data (MongoDB Shell)
```javascript
// Connect to MongoDB Atlas
mongosh "mongodb+srv://nizamuser:PASSWORD@cluster0.abc123.mongodb.net/nizam_ai"

// Switch database
use nizam_ai

// View all orders
db.orders.find()

// Find orders by email
db.orders.find({ email: "customer@example.com" })

// Count orders
db.orders.countDocuments()

// Get latest 5 orders
db.orders.find().sort({ createdAt: -1 }).limit(5)
```

---

## 7. Environment Variables Checklist

For production deployment, ensure you have:

- ✅ `MONGODB_URI` - MongoDB connection string
- ✅ `APP_URL` - Your production domain
- ✅ `PORT` - (Optional, defaults to 4000)
- ✅ `STRIPE_SECRET_KEY` - (Optional, for Stripe payments)
- ✅ `SES_REGION` - (Optional, for AWS SES emails)
- ✅ `SES_VERIFIED_SENDER` - (Optional, sender email address)

---

## 8. Collections Schema

### Orders Collection
```javascript
{
  orderReference: "ORDER-1717847784123",
  name: "Ahmed",
  email: "ahmed@example.com",
  address: "123 Main St, Dubai",
  items: [
    { product: { name: "T-Shirt", price: 50 }, quantity: 2 },
    { product: { name: "Jeans", price: 80 }, quantity: 1 }
  ],
  total: 180,
  currency: "AED",
  paymentMethod: "CARD|COD",
  status: "pending|paid|shipped|delivered",
  paymentIntent: "pi_xxxxx",
  createdAt: ISODate("2026-06-08T06:56:00.000Z")
}
```

### Users Collection
```javascript
{
  id: 1717847784123,
  name: "Ahmed",
  email: "ahmed@example.com",
  phone: "+971501234567",
  address: "123 Main St, Dubai",
  createdAt: ISODate("2026-06-08T06:56:00.000Z")
}
```

### Contacts Collection
```javascript
{
  name: "Ahmed",
  email: "ahmed@example.com",
  message: "I have a question about shipping...",
  createdAt: ISODate("2026-06-08T06:56:00.000Z")
}
```

---

## 9. Troubleshooting

### MongoDB Connection Fails
- ✅ Verify username/password in connection string
- ✅ Check IP is whitelisted in Network Access
- ✅ Ensure database name is correct (`nizam_ai`)

### API Returns 500 Error
```bash
# Check Vercel logs
vercel logs

# Or check local server
npm run build
node dist/Nizam/server/server.mjs
```

### Data Not Saving
- ✅ Verify `MONGODB_URI` is set in environment
- ✅ Check MongoDB Atlas collections exist
- ✅ Check user has permission to write to database

---

## 10. Scaling Tips

- **Free MongoDB tier:** 512MB storage
- **Upgrade when needed:** Go to MongoDB Atlas → Billing
- **Vercel Pro:** For unlimited deployments and better performance
- **Consider:** Adding Redis caching for frequently accessed data

---

## Next Steps

1. ✅ Set up MongoDB Atlas (above)
2. ✅ Deploy to Vercel
3. ✅ Add custom domain
4. ✅ Test API endpoints
5. ✅ Monitor data in MongoDB Atlas
6. ✅ Update app to use new endpoints

---

**Need Help?**
- MongoDB Docs: https://docs.mongodb.com/
- Vercel Docs: https://vercel.com/docs
- Angular SSR: https://angular.io/guide/ssr
