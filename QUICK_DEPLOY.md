# Quick Deployment Guide - MongoDB + Vercel

## 5-Minute Deployment Checklist

### ✅ Already Completed
- ✅ MongoDB package installed
- ✅ Server updated with MongoDB integration
- ✅ Build successful (1.79 MB server bundle)
- ✅ Environment file created (.env.example)
- ✅ GitHub Actions workflow ready
- ✅ DNS verified with GoDaddy

---

## 🚀 Deploy Now - 5 Steps

### Step 1: Create Free MongoDB Cluster (3 minutes)
```
1. Go to: https://www.mongodb.com/cloud/atlas
2. Sign up (free account)
3. Create "M0 Sandbox" cluster
4. Create user: nizamuser / [strong password]
5. Whitelist: Allow from anywhere
6. Copy connection string
7. Replace <password> with your password
```

**Connection String Format:**
```
mongodb+srv://nizamuser:YOUR_PASSWORD@cluster0.abc123.mongodb.net/nizam_ai?retryWrites=true&w=majority
```

---

### Step 2: Deploy to Vercel (2 minutes)

```bash
# Install Vercel CLI (one-time)
npm install -g vercel

# Deploy
cd /workspaces/Nizam.ai
vercel

# Follow prompts, then deploy to production
vercel --prod
```

---

### Step 3: Add Environment Variables (1 minute)

1. Open: https://vercel.com/dashboard
2. Select your project
3. Settings → Environment Variables
4. Add these 5 variables:

| Name | Value |
|------|-------|
| MONGODB_URI | Your connection string from Step 1 |
| APP_URL | https://your-vercel-domain.vercel.app |
| STRIPE_SECRET_KEY | (skip if not using Stripe yet) |
| SES_REGION | (skip if not using AWS SES yet) |
| SES_VERIFIED_SENDER | (skip if not using AWS SES yet) |

---

### Step 4: Redeploy with Env Vars (10 seconds)

```bash
vercel --prod
```

---

### Step 5: Connect Custom Domain (30 seconds)

1. Vercel Dashboard → Project → Settings → Domains
2. Add Domain: `ammawears.com`
3. Follow DNS instructions (already configured with GoDaddy)

---

## ✨ Done! Your App is Live

**Your app now has:**
- ✅ Persistent MongoDB database
- ✅ User profiles saved
- ✅ Orders stored in database
- ✅ Contact submissions saved
- ✅ Running on your custom domain

---

## 🧪 Test It Works

```bash
# Test API (replace with your domain)
curl https://ammawears.com/api/save-user \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","phone":"+1234567890","address":"Dubai"}'

# Expected response:
# {"success":true,"userId":"60d5ec49c1234567890abcde","message":"User profile saved successfully."}
```

---

## 📊 Monitor Your Data

View all saved data in MongoDB:
1. Go to: https://cloud.mongodb.com
2. Select your cluster
3. Click "Collections"
4. View `orders`, `users`, `contacts`

---

## ❓ Need Help?

See detailed guides:
- **Full Setup**: [MONGODB_SETUP.md](./MONGODB_SETUP.md)
- **Implementation Details**: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

---

## 🎯 Deployment Flow

```
Your Code
    ↓
npm run build
    ↓
Vercel Deploy
    ↓
MONGODB_URI env var
    ↓
Connect to MongoDB Atlas
    ↓
Create Collections (orders, users, contacts)
    ↓
App Running on https://ammawears.com
```

---

## 💰 Cost

**MongoDB Atlas**: FREE tier (512MB storage)
**Vercel**: FREE tier (100GB/month bandwidth)
**Total Monthly Cost**: $0

Upgrade when needed - pay as you scale!
