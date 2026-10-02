# Dockerfile for Nizam.ai Angular SSR Application
# Multi-stage build for smaller production image

# Stage 1: Build the application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies.
# --include=dev is required: `sharp`, `@angular/cli`, `@angular/build` and
# `typescript` are devDependencies that `npm run build` genuinely needs.
# Without it, a NODE_ENV=production build environment silently omits them and
# the build dies with `Cannot find package 'sharp'` / `ng: not found`.
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build the application (including SSR)
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy built application from builder
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 4000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start the server
CMD ["node", "dist/Nizam/server/server.mjs"]
