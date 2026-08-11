# Future MongoDB Enhancements Plan for Nizam.ai E-commerce Platform

This document outlines planned enhancements to leverage MongoDB's capabilities for improved functionality, scalability, and user experience in the Nizam.ai e-commerce application.

## Overview

Currently, the application uses:
- Static JSON files for product catalog
- MongoDB only for order storage
- No user authentication system

Planned enhancements will migrate more data to MongoDB, implement user accounts, and add features that increase engagement and operational efficiency.

## 1. User Accounts & Authentication System

### Purpose
Enable personalized experiences, order history, saved addresses, and administrative capabilities.

### MongoDB Schema
```javascript
// users collection
{
  _id: ObjectId,
  email: { type: String, unique: true, required: true },
  passwordHash: String,
  firstName: String,
  lastName: String,
  phone: String,
  addresses: [{
    type: { type: String, enum: ['billing', 'shipping'] },
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
    isDefault: Boolean
  }],
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date,
  isActive: Boolean,
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}
```

### Implementation Steps
1. Add JWT-based authentication to Express routes (`/api/register`, `/api/login`, `/api/logout`)
2. Implement password hashing with bcrypt
3. Modify order creation to associate with `userId`
4. Create Angular auth service with token storage and route guards
5. Build login/register pages and profile management UI
6. Add admin role-based access controls

### Priority: **High** (Foundation for other features)
## 2. Product Catalog in MongoDB (vs. JSON files)

### Purpose
Move from static JSON files to dynamic MongoDB storage for:
- Real-time product updates without redeploys
- Dynamic inventory management
- Advanced search and filtering capabilities
- Product variants (sizes, colors, etc.)

### MongoDB Schema
```javascript
// products collection
{
  _id: ObjectId,
  name: String,
  description: String,
  basePrice: Number,
  currency: String,
  category: String,
  images: [String],
  variants: [{
    _id: ObjectId,
    attributes: { size: String, color: String }, // Dynamic attributes
    sku: String,
    priceAdjustment: Number,
    stock: Number,
    barcode: String
  }],
  arModelUrl: String,
  arPreviewAvailable: Boolean,
  tags: [String],
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Implementation Steps
1. Create product management API endpoints (CRUD operations)
2. Update `ProductService` to fetch from `/api/products` instead of JSON files
3. Build admin UI for product creation/editing
4. Implement search/filter endpoints (`/api/products?category=shoes&minPrice=100`)
5. Migrate existing product data from JSON to MongoDB
6. Add product image upload functionality (optional enhancement)

### Priority: **High** (Replaces fragile static files)
## 3. Wishlist / Saved Items Feature

### Purpose
Increase user engagement and conversion rates by allowing savable items for later purchase.

### MongoDB Schema
```javascript
// wishlists collection
{
  _id: ObjectId,
  userId: ObjectId, // Refers to users collection
  name: String, // e.g., "Wishlist", "Birthday Ideas", "Holiday Gifts"
  items: [{
    productId: ObjectId, // Refers to products collection
    variantId: ObjectId, // Optional, for specific variants
    addedAt: Date,
    notes: String
  }],
  isPublic: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Implementation Steps
1. Add wishlist API endpoints:
   - `GET /api/wishlist` (user's wishlists)
   - `POST /api/wishlist` (create new wishlist)
   - `GET /api/wishlist/:id` (get wishlist with items)
   - `POST /api/wishlist/:id/items` (add item)
   - `DELETE /api/wishlist/:id/items/:itemId` (remove item)
2. Create wishlist service in Angular
3. Add "Save to Wishlist" buttons on product cards and detail pages
4. Build wishlist management page (view, edit, share wishlists)
5. Optional: Add social sharing capabilities

### Priority: **Medium** (High engagement impact, relatively simple)
## 4. Product Reviews & Ratings System

### Purpose
Build trust through social proof, improve SEO, and provide valuable feedback.

### MongoDB Schema
```javascript
// reviews collection
{
  _id: ObjectId,
  productId: ObjectId,
  userId: ObjectId,
  rating: { type: Number, min: 1, max: 5 },
  title: String,
  comment: String,
  images: [String], // Optional photo uploads
  verifiedPurchase: Boolean, // Set to true if user purchased item
  helpfulVotes: Number,
  createdAt: Date,
  updatedAt: Date
}
```

### Implementation Steps
1. Add review API endpoints:
   - `GET /api/products/:id/reviews` (get reviews for product)
   - `POST /api/products/:id/reviews` (submit review)
   - `PUT /api/reviews/:id/helpful` (vote on helpfulness)
2. Create review component in Angular (star rating + comment form)
3. Display average rating and review count on product cards/pages
4. Add "Verified Purchase" badge for reviews from buyers
5. Implement review moderation endpoints for admins
6. Add review summary statistics (rating distribution)

### Priority: **Medium** (Builds trust and SEO value)
## 5. Inventory Management & Low Stock Alerts

### Purpose
Prevent overselling, improve operational efficiency, and reduce stockouts.

### Enhancement to Existing Schemas
- Product variants already support `stock` field
- Add inventory alerts collection (optional):
```javascript
{
  _id: ObjectId,
  productId: ObjectId,
  variantId: ObjectId,
  threshold: Number, // Alert when stock <= this
  currentStock: Number,
  lastChecked: Date,
  notificationSent: Boolean
}
```

### Implementation Steps
1. Add stock validation to order creation (check availability before processing)
2. Create low-stock API endpoint (`/api/inventory/low-stock?threshold=5`)
3. Build admin dashboard showing inventory levels and alerts
4. Implement automatic email alerts for low stock (using existing SES setup)
5. Add stock adjustment endpoints for returns/restocking
6. Implement reservation system for cart items (optional, for high-traffic scenarios)

### Priority: **High** (Critical for operations)
## 6. Enhanced Order Tracking & Status Updates

### Purpose
Improve post-purchase experience and reduce customer service inquiries.

### Enhancement to Existing Orders Schema
```javascript
// Add to existing order schema
statusHistory: [{
  status: { type: String, enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'] },
  timestamp: Date,
  notes: String,
  updatedBy: ObjectId // Reference to admin/user who made change
}],
currentStatus: String,
estimatedDelivery: Date,
trackingNumber: String,
shippingCarrier: String,
shippingMethod: String
```

### Implementation Steps
1. Add order status update API (admin only): `PUT /api/orders/:id/status`
2. Create order tracking page in Angular (timeline view)
3. Send automated email updates when status changes (using existing SES setup):
   - Order confirmed
   - Payment received
   - Item shipped
   - Out for delivery
   - Delivered
4. Add admin interface to update order statuses with notes
5. Implement shipment tracking integration (optional)
6. Add estimated delivery date calculation based on shipping method

### Priority: **Medium** (Improves customer experience)

## Implementation Priority Recommendation

1. **User Authentication** (Foundation for all other features)
2. **Product Catalog Migration** (Replaces static JSON files)
3. **Inventory Management** (Critical for operations)
4. **Wishlist Feature** (High engagement impact)
5. **Product Reviews** (Builds trust and SEO value)
6. **Enhanced Order Tracking** (Improves customer experience)

## Quick Wins for Immediate Impact

If you want to start small with immediate business impact:

1. **Add user authentication first** - Enables personalized features and order history (2-3 days)
2. **Migrate products to MongoDB** - Replace JSON file import with API calls (2 days)
3. **Add a simple "Save for Later" feature** - Minimal viable wishlist (productId + userId only, 1 day)

## Technical Considerations

- All new API endpoints should follow REST conventions and include proper error handling
- Implement JWT authentication with refresh tokens for security
- Use MongoDB indexing strategically for query performance:
  - Users: email (unique), role
  - Products: category, isActive, name (text index for search)
  - Orders: userId, createdAt, status
  - Reviews: productId, createdAt
  - Wishlists: userId, isPublic
- Consider implementing rate limiting on public APIs
- Add comprehensive logging for auditing and debugging
- Write unit and integration tests for new functionality

---

*Last Updated: $(date)*