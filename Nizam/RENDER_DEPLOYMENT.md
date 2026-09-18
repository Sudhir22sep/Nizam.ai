# Nizam.ai - Angular SSR Application

## Build Commands
```bash
# Build the application (run this in CI/CD)
npm run build

# Start the server (for local production testing)
node dist/Nizam/server/main.server.mjs

# Development SSR (requires ng serve --ssr)
npm run dev:ssr
```

## Environment Variables Required

### Required for Production
| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/nizam_ai` |
| `SES_REGION` | AWS SES region for emails | `us-east-1` |
| `SES_VERIFIED_SENDER` | Verified sender email | `noreply@yourdomain.com` |
| `RAZORPAY_KEY_ID` | Razorpay live key ID | `rzp_live_...` |
| `RAZORPAY_KEY_SECRET` | Razorpay live key secret | `...` |
| `APP_URL` | Your production URL | `https://nizam.ai` |
| `PORT` | Port (Render sets this automatically) | `10000` |

### Optional
| Variable | Description | Default |
|----------|-------------|---------|
| `RAZORPAY_TEST_KEY_ID` | Razorpay test key ID | - |
| `RAZORPAY_TEST_KEY_SECRET` | Razorpay test key secret | - |

## Render Deployment Steps

### 1. Create a New Web Service on Render
1. Go to https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub/GitLab repository
4. Select the `Nizam.ai` repository

### 2. Configure the Service
```
Name: nizam-ai (or your preferred name)
Region: Oregon (US West) or closest to your users
Branch: main (or your production branch)
Runtime: Node
Build Command: npm ci && npm run build
Start Command: node dist/Nizam/server/main.server.mjs
```

### 3. Set Environment Variables
In Render dashboard → Settings → Environment Variables, add:

**Required:**
- `MONGODB_URI` = your MongoDB Atlas connection string
- `JWT_SECRET` = at least 32 random bytes (base64/hex). **The server exits at startup with `JWT_SECRET must be set in the runtime environment` if this is missing**, and every login/register call 500s without it.
- `SES_REGION` = `us-east-1` (or your SES region)
- `SES_VERIFIED_SENDER` = your verified SES email (must be a verified identity; the SES sandbox also requires verified recipients)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` = IAM user with `ses:SendEmail` + `ses:SendRawEmail`. Optional: omit both to use the AWS SDK default credential chain (environment, `AWS_PROFILE`/SSO, instance role).
- `RAZORPAY_KEY_ID` = your Razorpay live key ID
- `RAZORPAY_KEY_SECRET` = your Razorpay live key secret
- `APP_URL` = `https://your-app.onrender.com` (or custom domain)
- `CORS_ORIGIN` = the frontend origin allowed to call this API (e.g. `https://ammawears.com`); defaults to `http://localhost:4200` if unset

**Optional (for testing):**
- `RAZORPAY_TEST_KEY_ID` = test key
- `RAZORPAY_TEST_KEY_SECRET` = test secret

> **Blueprint note:** Render reads `render.yaml` from the **repository root** (`Nizam.ai/render.yaml`), which sets
> `workingDirectory: ./Nizam`. The copy at `Nizam/render.yaml` is not read by Render.
>
> **`.env` note:** the server loads a `.env` file only as a *fallback* - values injected by Render always win.
> Never rely on a committed `.env` in production, and never commit real secrets.

### 4. Add MongoDB (if not using Atlas)
If you want Render to manage MongoDB:
1. Create a "Redis" or "PostgreSQL" database on Render
2. Note: For MongoDB, use MongoDB Atlas (free tier available) as Render doesn't offer managed MongoDB

### 5. Deploy
Click "Create Web Service" - Render will build and deploy automatically.

## Health Check
Your app has these endpoints for monitoring:
- `GET /` - Main app (serves Angular)
- `GET /api/health` - Add this endpoint for health checks (see below)

## Adding Health Check Endpoint

Add this to `src/server.ts` before the Angular catch-all route:

```typescript
// Health check endpoint for Render
app.get('/api/health', async (req, res) => {
  try {
    // Optionally check MongoDB connection
    if (db) {
      await db.admin().ping();
    }
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});
```

## Custom Domain (Optional)
1. In Render dashboard → Settings → Custom Domains
2. Add your domain (e.g., `nizam.ai`)
3. Update DNS records as instructed
4. Update `APP_URL` environment variable to your custom domain

## Important Notes

### Static Files
The Angular build outputs to `dist/Nizam/browser/` - these are served by Express with 1-year cache headers.

### SSR vs CSR
- Production: Full SSR with `AngularNodeAppEngine` (requires manifest from build)
- Development: Falls back to CSR (`index.csr.html`) when manifest not found

### MongoDB Connection
The app gracefully handles MongoDB connection failures - API endpoints will return appropriate errors but the server stays running.

### Render Free Tier Limitations
- Spins down after 15 minutes of inactivity
- Cold starts take 30-60 seconds
- Consider paid plan for production use

## Local Development with MongoDB

```bash
# Start MongoDB locally (Docker)
docker run -d -p 27017:27017 --name mongodb mongo:7

# Or use MongoDB Atlas free tier
# Set MONGODB_URI in .env file

# Run dev server
npm run dev:ssr
```

## Troubleshooting

### Build Fails
- Ensure Node version matches (check `.nvmrc` or `package.json` engines)
- Clear cache: `rm -rf node_modules package-lock.json && npm install`

### Server Won't Start
- Check `MONGODB_URI` is set correctly
- Verify `PORT` environment variable (Render sets this automatically)

### SSR Not Working
- Verify `angular-app-engine-manifest.mjs` exists in `dist/Nizam/server/`
- Check build used `@angular/build:application` builder

### Emails Not Sending
Run the diagnostic first (from the `Nizam/` directory) — it reports exactly which
value is missing or still a placeholder, and whether AWS credentials resolve:

```bash
node scripts/check-ses-credentials.cjs                      # config + credential check
node scripts/check-ses-credentials.cjs --send-to you@x.com  # + a real test email
```

Then check, in this order:
- **Credentials**: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` must be real IAM
  keys (with `ses:SendEmail` + `ses:SendRawEmail`). Without them the server logs
  `Could not load credentials from any providers`. They are needed locally too —
  put them in `Nizam/.env` as well as in the Render dashboard.
- `SES_VERIFIED_SENDER` must be a **verified identity in AWS SES**, in the same
  region as `SES_REGION` (identities are per-region).
- Shell/Codespaces environment variables **override** `.env` (the loader never
  overrides real environment variables), so a stale exported
  `SES_VERIFIED_SENDER=your-email@example.com` wins over the file. The startup
  log names the effective value.
- Verify SES is in production mode (not sandbox); in the sandbox every recipient
  must be verified too.

## File Structure (Production Build)
```
dist/Nizam/
├── browser/           # Client-side assets
│   ├── index.csr.html # CSR fallback
│   ├── index.server.html
│   ├── main-*.js
│   └── styles-*.css
└── server/            # Server-side bundle
    ├── main.server.mjs        # Entry point (run this)
    ├── angular-app-manifest.mjs
    ├── angular-app-engine-manifest.mjs
    └── *.mjs                  # Server chunks
```

## Monitoring & Logs
- View logs in Render dashboard → Logs
- Add logging to your API endpoints for debugging
- Consider adding error tracking (Sentry, etc.)