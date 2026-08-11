# Backend Refactoring Guide: From Monolithic `server.ts` to Modular Architecture

---

## Short Answer
- It’s not “wrong” to have a single `server.ts` that holds every route, but as the codebase grows it becomes hard to read, test, and maintain.
- Best practice for a Node/Express/TypeScript backend is to split concerns:
  - Keep `server.ts` for **bootstrap only** (middleware, DB connection, router registration, error handling, server start).
  - Move each logical group of endpoints into its own **router/controller/service** files.
- Adopt a layered (or hexagonal) architecture:
  ```
  src/
   ├─ server.ts                # app bootstrap & global middleware
   ├─ config/                  # env‑based configuration
   ├─ middleware/              # custom middleware (auth, validation, errorHandler)
   ├─ routes/                  # one file per feature (express.Router)
   │   ├─ auth.routes.ts
   │   ├─ product.routes.ts
   │   ├─ order.routes.ts
   │   ├─ wishlist.routes.ts
   │   └─ contact.routes.ts
   ├─ controllers/             # thin layer that calls services & formats responses
   │   ├─ auth.controller.ts
   │   ├─ product.controller.ts
   │   ├─ order.controller.ts
   │   ├─ wishlist.controller.ts
   │   └─ contact.controller.ts
   ├─ services/                # business logic (DB calls, 3rd‑party APIs)
   │   ├─ auth.service.ts
   │   ├─ product.service.ts
   │   ├─ order.service.ts
   │   ├─ wishlist.service.ts
   │   └─ contact.service.ts
   ├─ models/                  # TypeScript interfaces or ODM schemas
   │   ├─ User.ts
   │   ├─ Product.ts
   │   ├─ Order.ts
   │   ├─ Wishlist.ts
   │   └─ Contact.ts
   ├─ utils/                   # helpers (password hash, JWT, email sender, etc.)
   └─ types/                   # shared DTOs / request/response shapes
  ```

## Why a Huge `server.ts` Is Problematic

| Problem | Symptom in current file | Impact |
|---------|------------------------|--------|
| **Low readability** | >2000 lines of mixed middleware, route handlers, DB connection logic, helper functions | Hard to locate a specific endpoint; lots of scrolling. |
| **Hard to test** | Route handlers are anonymous inline functions; cannot be imported directly for unit tests. | Requires spinning up the whole Express app or using supertest on the entire server. |
| **Merge conflicts** | Every feature edit touches the same massive file → frequent conflicts in a team. | Slows down collaboration. |
| **Violation of SRP** | The file does *everything*: bootstrapping, routing, business logic, error handling. | Changing one concern risks breaking unrelated parts. |
| **No clear boundaries** | No obvious place to add validation, logging, or authentication without digging into the same block. | Increases chance of bugs and makes onboarding harder. |
## High‑Level Refactoring Plan

1. **Thin `server.ts`** – only:
   - Load environment (`dotenv`).
   - Set up global middleware (`express.json()`, `cors()`, request logging, etc.).
   - Initialise MongoDB client (or DB connection pool).
   - Register feature routers (`app.use('/api/auth', authRouter);` …).
   - Add global error‑handling middleware.
   - Start HTTP server (`app.listen(PORT)`).

2. **Create a router per feature** (`src/routes/*.routes.ts`):
   - Instantiate `express.Router()`.
   - Import the corresponding controller (or call service directly).
   - Define HTTP verbs and paths (`router.post('/login', authController.login);`).

3. **Extract controllers** (`src/controllers/*.controller.ts`):
   - Receive `req`, `res`, `next`.
   - Validate input (via DTO or validation library).
   - Call the appropriate service method.
   - Format the response (`res.status(200).json({ … })`).
   - Keep them thin – no direct DB calls.

4. **Move business logic to services** (`src/services/*.service.ts`):
   - Contain all DB queries, calls to 3rd‑party APIs (Razorpay, SES, etc.).
   - Return plain objects or throw typed errors.
   - Easy to unit‑test in isolation (mock the DB layer).

5. **Define models / interfaces** (`src/models/*.ts`):
   - If using raw MongoDB driver, keep TypeScript interfaces describing document shape.
   - If later switching to an ODM (Mongoose, TypeORM, Prisma), this is where the schema lives.

6. **Add custom middleware** (`src/middleware/`):
   - `authenticateJwt` – extracts & verifies JWT, attaches `req.user`.
   - `validateRequest` – runs a Joi/class‑validator/zod schema on `req.body`, `req.query`, `req.params`.
   - `asyncHandler` – wraps async route handlers to forward errors to the global error handler.
   - `errorHandler` – centralised logging & JSON error response.

7. **Utility helpers** (`src/utils/`):
   - Password hashing/comparison (`bcryptjs`).
   - JWT sign/verify (`jsonwebtoken`).
   - Email sender (SES wrapper).
   - Razorpay wrapper.

8. **Configuration** (`src/config/`):
   - Load `.env` via `dotenv`.
   - Export a typed config object (`appConfig`) with defaults & validation (`zod`, `dotenv-safe`).

9. **Update `tsconfig.json`** (if needed) to enable path aliases (`@/routes/*`, `@/controllers/*`, etc.) for cleaner imports.

10. **Run the app** after each step, verifying that the server still starts and existing API contracts (JSON shape, status codes) remain unchanged.
## Minimal Working Example – Refactoring the Login Endpoint

### 1. `src/routes/auth.routes.ts`
```ts
import { Router } from 'express';
import { loginController } from '../controllers/auth.controller';
import { validateRequest } from '../middleware/validateRequest';
import { loginSchema } from '../types/auth.dto';

const router = Router();

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and return JWT
 * @access  Public
 */
router.post(
  '/login',
  validateRequest(loginSchema),   // validates req.body
  asyncHandler(loginController.login) // controller wrapped for error handling
);

export default router;
```

### 2. `src/controllers/auth.controller.ts`
```ts
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AsyncHandler } from '../types/utils';

const authService = new AuthService();

export const loginController = {
  login: ((req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;
    authService
      .login(email, password)
      .then((result) => res.status(200).json(result))
      .catch(next);
  }) as AsyncHandler,
};
```

### 3. `src/services/auth.service.ts`
```ts
import { compare } from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { MongoClient, Db, Collection } from 'mongodb';
import { AppError } from '../utils/AppError';
import { config } from '../config';

export class AuthService {
  private users!: Collection;

  constructor() {
    // In a real app you’d inject the DB connection; here we lazily init.
  }

  private async ensureDb() {
    if (!this.users) {
      const client = await MongoClient.connect(config.mongoUri);
      const db: Db = client.db(config.dbName);
      this.users = db.collection('users');
    }
  }

  async login(email: string, password: string) {
    await this.ensureDb();
    const user = await this.users.findOne({ email });
    if (!user) throw new AppError('Invalid credentials', 401);

    const passwordMatch = await compare(password, user.passwordHash);
    if (!passwordMatch) throw new AppError('Invalid credentials', 401);

    const payload = { sub: user._id.toString(), email: user.email };
    const token = sign(payload, config.jwtSecret, { expiresIn: '7d' });

    return {
      success: true,
      token,
      user: {
        id: user._id.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        // … other safe fields
      },
    };
  }
}
```

### 4. `src/middleware/validateRequest.ts` (example using `zod`)
```ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export const validateRequest =
  (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: result.error.errors,
      });
    }
    // Optionally attach parsed values to request for typed usage
    req.body = result.data.body;
    req.query = result.data.query;
    req.params = result.data.params;
    next();
  };
```

### 5. `src/types/auth.dto.ts` (Zod schema)
```ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
```

### 6. Updated `src/server.ts` (excerpt)
```ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRouter from './routes/auth.routes';
// … import other routers …

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN }));
// … other global middlewares (logger, etc.) …

// Feature routers
app.use('/api/auth', authRouter);
app.use('/api/products', productRouter);
app.use('/api/orders', orderRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/contact', contactRouter);

// Global error handler (must be last)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message ?? 'Internal Server Error',
  });
});

const PORT = process.env.PORT ?? 4000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
```
## Benefits of the Refactor

| Benefit | Explanation |
|---------|-------------|
| **Readability & Navigation** | Each file is usually <150 lines (often <80). Jump straight to the feature you need. |
| **Testability** | Controllers & services can be unit‑tested in isolation (mock the DB layer). Route tests can be done with `supertest` against isolated routers if desired. |
| **Parallel Development** | Two developers can work on `auth.routes.ts` and `product.routes.ts` without stepping on each other’s toes. |
| **Clear Separation of Concerns** | - **Routing**: HTTP verbs, paths, middleware.<br>- **Controllers**: Request/response translation.<br>- **Services**: Pure business logic.<br>- **Models/DTOs**: Data shape.<br>- **Middleware**: Cross‑cutting concerns (auth, validation, error handling). |
| **Easier Refactoring / Tech‑Swap** | Swapping MongoDB driver for an ORM (Prisma, TypeORM) only touches the service layer; controllers & routes stay unchanged. |
| **Consistent Error Handling** | Single `errorHandler` middleware catches all async errors (via `asyncHandler` wrapper) and returns a uniform JSON shape. |
| **Validation Centralisation** | Validation library (Joi, Zod, class‑validator) guarantees malformed requests never reach business logic. |
| **Scalability** | Adding a new feature (e.g., `/api/payments`) is just a new router + controller + service – no need to scroll through a massive file. |
| **Better IDE Support** | Smaller files mean faster indexing, quicker navigation, and more accurate refactoring suggestions. |
## Optional Advanced Enhancements

| Idea | When to consider it | How to add it |
|------|---------------------|---------------|
| **Dependency Injection (DI)** | Large services with many dependencies (multiple repos, external APIs). | Use `tsyringe` or `awilix` to inject `AuthService`, `ProductService`, etc., into controllers. |
| **Repository Pattern** | Want to abstract DB access further (support multiple DBs or mock easily). | Create `src/repositories/UserRepository.ts` exposing `findByEmail`, `create`, etc.; inject repository into `AuthService`. |
| **DTOs (Data Transfer Objects)** | Want to strictly shape API payloads, hiding internal DB fields. | Define `LoginDto`, `RegisterDto`, `OrderDto` in `src/types/`; map entity → DTO in service/controller. |
| **API Versioning** | Anticipate breaking changes in the future. | Prefix routes: `app.use('/api/v1/auth', authRouter);` |
| **Swagger/OpenAPI Docs** | Want auto‑generated documentation for frontend teams. | Add `tsoa` or `swagger-jsdoc` decorators to controllers/routes; serve `/api-docs`. |
| **Rate Limiting & Security Headers** | Public APIs need protection against abuse. | Install `express-rate-limit` and `helmet`; apply as global middleware. |
| **Logging** | Better observability in production. | Replace `console.log` with `pino` or `winston`; log request IDs, duration, error stacks. |
| **Circuit Breaker / Retry for 3rd‑party** | Calls to Razorpay/SES may fail intermittently. | Use `opossum` or `async-retry` wrappers inside service methods. |
| **Docker‑Compose for Local Dev** | Want MongoDB + app + maybe Redis in one command. | Write a `docker-compose.yml` that spins up `mongo` and the node service, linking via network. |
| **CI/CD Pipeline** | Automated testing & deployment. | Add a GitHub Actions workflow that runs `npm test`, builds the Docker image, and pushes to a registry. |
## Quick Checklist – Is Your Refactor Done?

- [ ] `server.ts` only contains: dotenv, global middleware, DB connection, router registration, error handling, `app.listen`.
- [ ] Each feature (`auth`, `product`, `order`, `wishlist`, `contact`, …) has:
  - `src/routes/<feature>.routes.ts` (express.Router)
  - `src/controllers/<feature>.controller.ts` (thin)
  - `src/services/<feature>.service.ts` (business logic)
  - (optional) `src/models/<feature>.ts` (TS interfaces)
  - (optional) `src/types/<feature>.dto.ts` (validation schemas)
- [ ] All route handlers are wrapped with `asyncHandler` (or try/catch) so errors flow to the global error handler.
- [ ] Validation middleware runs **before** the controller.
- [ ] Authentication middleware (`authenticateJwt`) is applied to protected routes.
- [ ] No direct `db.collection(...)` calls linger inside route files.
- [ ] The app still starts (`npm run dev:ssr` or `npm start`) and all existing endpoints return the exact same JSON shape and status codes (run Postman collection or automated tests to confirm).
- [ ] Linting (`eslint`) and formatting (`prettier`) pass with no new errors.
- [ ] Unit tests for at least one service and one controller pass (e.g., `auth.service.spec.ts`).

If the checklist is green, you’ve successfully moved from a monolithic `server.ts` to a maintainable, scalable backend architecture.
## TL;DR Action Plan for You

1. **Create the folder structure** (`routes/`, `controllers/`, `services/`, `models/`, `utils/`, `middleware/`, `config/`).
2. **Move the DB connection logic** into a small `db.ts` helper (singleton MongoClient) and import it where needed.
3. **Pick one feature** (e.g., *auth*) and follow the example above to create its router, controller, and service.
4. **Replace the corresponding inline handlers** in `server.ts` with `app.use('/api/auth', authRouter);`.
5. **Run the app** and verify the auth endpoints still work (login, register, profile, etc.).
6. **Repeat** for each remaining feature (products, orders, wishlist, contact, etc.).
7. **Add global middleware** (logger, error handler, validation wrapper) and delete the old inline versions from `server.ts`.
8. **Run your test suite** (or manually test) to ensure nothing broke.
9. **Commit** the changes – you now have a clean, modular backend ready for future features.

---

### Final Thought
A large `server.ts` works for a proof‑of‑concept or a tiny hobby project, but once you start adding more endpoints, business rules, or team members, the cost of maintenance grows quadratically. By adopting the layered/router‑controller‑service pattern shown above, you’ll gain:

- **Immediate readability** (each file tells a clear story).  
- **Safer refactoring** (changes are isolated).  
- **Better testability** (unit‑test services without spinning up HTTP).  
- **Easier onboarding** (new developers can find the code they need in seconds).  

Give it a try on one feature first; you’ll see the difference right away, and then you can expand the pattern to the whole codebase. Happy coding! �� 🚀