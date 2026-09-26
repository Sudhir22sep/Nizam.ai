import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { serverRoutes } from './app/app.routes.server';

/**
 * Server bootstrap.
 *
 * `provideServerRendering` supplies the server platform providers (DOM
 * emulation for `document`/`window` access, and server-side rendering). Without
 * it the platform is only half-initialised on the server and every render fails
 * with NG0401, which is why the catch-all middleware silently fell back to the
 * empty client shell.
 *
 * Render modes must be declared here through `withRoutes`: without it the
 * builder assumes every route is prerendered, which fails the build on the
 * parameterized `product/:id` route ("uses prerendering and includes
 * parameters, but 'getPrerenderParams' is missing"). `app.routes.server.ts`
 * is the single source of truth for them, so the two cannot drift.
 *
 * The incoming `context` must be forwarded to `bootstrapApplication`. The SSR
 * engine invokes this function with a context carrying the already-created
 * `platformRef`; dropping it leaves the platform half-initialised and every
 * render fails with NG0401.
 */
const serverConfig = {
  ...appConfig,
  providers: [
    ...(appConfig.providers ?? []),
    provideServerRendering(withRoutes(serverRoutes)),
  ],
};

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, serverConfig, context);

export default bootstrap;
