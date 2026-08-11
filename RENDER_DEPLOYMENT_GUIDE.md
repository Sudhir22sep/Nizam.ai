# Render Free Tier Deployment Guide for Nizam.ai

## 🚀 First-Time Deployment to Render Free Tier

### Prerequisites
- GitHub/GitLab/Bitbucket account
- Your code pushed to a repository
- MongoDB Atlas account (for database)
- Razorpay account (for payments)
- AWS SES verified (for emails) — *or skip email features initially*

---

### Step 1: Push Your Code to GitHub

```bash
cd /workspaces/Nizam.ai
git add .
git commit -m "Fix dotenv, add Render deployment config"
git push origin main
```

---

### Step 2: Create MongoDB Atlas Database (Free Tier)

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas) → Sign up/Login
2. **Create a new project** → Name it `nizam-ai`
3. **Build a Database** → Choose **FREE (M0)** tier
   - Cloud Provider: **AWS**
   - Region: Choose closest to Render's Oregon (e.g., `us-east-1`)
4. **Create Database User**:
   - Username: `nizam_user`
   - Password: Generate secure password → **Save it!**
5. **Network Access** → Add IP Address → **Allow Access from Anywhere** (`0.0.0.0/0`) — *required for Render*
6. **Connect** → Drivers → Copy **Connection String** (looks like):
   ```
   mongodb+srv://nizam_user:<password>@cluster.mongodb.net/nizam_ai?retryWrites=true&w=majority
   ```
   Replace `<password>` with your actual password.

---

### Step 3: Create Render Account & New Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/) → Sign up with GitHub
2. Click **New +** → **Web Service**
3. **Connect your repository** (select your `Nizam.ai` repo)
4. Configure:
   | Setting | Value |
   |---------|-------|
   | **Name** | `nizam-ai` |
   | **Region** | `Oregon (US West)` — *free tier only* |
   | **Branch** | `main` |
   | **Runtime** | `Node` |
   | **Root Directory** | `Nizam` |
   | **Build Command** | `npm install && npm run build` |
   | **Start Command** | `node dist/Nizam/server/main.server.mjs` |
   | **Plan** | **Free** |

5. Click **Advanced** → Add **Environment Variables**:

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | |
| `PORT` | `4000` | |
| `MONGODB_URI` | *your Atlas connection string* | **Secret** |
| `SES_REGION` | `us-east-1` | Or your AWS region |
| `SES_VERIFIED_SENDER` | `your-verified@email.com` | Must be verified in AWS SES |
| `RAZORPAY_KEY_ID` | `rzp_test_...` | Use **test keys** for now |
| `RAZORPAY_KEY_SECRET` | *test secret* | **Secret** |
| `RAZORPAY_TEST_KEY_ID` | `rzp_test_...` | Same as above |
| `RAZORPAY_TEST_KEY_SECRET` | *test secret* | **Secret** |
| `APP_URL` | `https://nizam-ai.onrender.com` | Update after first deploy |
| `environment` | `production` | |

> **Important**: Click the **lock icon** 🔒 next to sensitive values (MongoDB URI, Razorpay secrets) to mark them as **Secret**.

6. **Health Check Path**: `/health` (already in render.yaml)
7. Click **Create Web Service**

---

### Step 4: Wait for First Deploy

- Build takes **3–5 minutes** on free tier
- Watch logs for:
  - ✅ `npm install` completes
  - ✅ `ng build` succeeds (outputs to `dist/Nizam/`)
  - ✅ `Node Express server listening on http://localhost:4000`

---

### Step 5: Update APP_URL After Deploy

1. Once deployed, copy your **Render URL** (e.g., `https://nizam-ai-xyz.onrender.com`)
2. Go to **Environment** tab in Render Dashboard
3. Update `APP_URL` to your actual URL
4. **Save Changes** → triggers auto-redeploy

---

### Step 6: Verify Deployment

| Endpoint | Expected |
|----------|----------|
| `https://your-app.onrender.com/` | Angular app loads |
| `https://your-app.onrender.com/health` | `{"status":"ok"}` |
| `https://your-app.onrender.com/api/products` | JSON response (if API exists) |

---

## ⚠️ Free Tier Limitations

| Limitation | Details |
|------------|---------|
| **Spin-down** | Service spins down after 15 min inactivity → first request takes 30–60s to wake up |
| **Build minutes** | 500 min/month (enough for ~10–15 builds) |
| **RAM/CPU** | 512 MB RAM, shared CPU |
| **Bandwidth** | 100 GB/month |
| **Custom domains** | ✅ Supported on free tier |
| **SSL** | ✅ Automatic HTTPS |

---

## 🔧 Optional: Custom Domain (Free)

1. Render Dashboard → Your Service → **Settings** → **Custom Domains**
2. Add `www.yourdomain.com` → Follow DNS instructions (CNAME to `your-app.onrender.com`)
3. SSL auto-provisions via Let's Encrypt

---

## 🐛 Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails: `ENOTFOUND` MongoDB | Check `MONGODB_URI` is correct; Atlas IP whitelist = `0.0.0.0/0` |
| Server crashes on start | Check logs → usually missing env var or MongoDB connection |
| 502 Bad Gateway | App didn't start on `PORT` (must use `process.env.PORT` or `4000`) |
| CORS errors | Ensure `APP_URL` matches your frontend origin exactly |

---

## ✅ Quick Checklist Before Deploy

- [ ] Code pushed to GitHub
- [ ] MongoDB Atlas M0 cluster created + IP whitelist `0.0.0.0/0`
- [ ] MongoDB user created + connection string ready
- [ ] Razorpay test keys ready (Dashboard → Settings → API Keys)
- [ ] AWS SES verified sender (or skip email features)
- [ ] Render account created + repo connected

---

Once deployed, your app will be live at `https://nizam-ai-xyz.onrender.com` 🎉