# nizam.ai

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.1.1.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Deployment

### Jenkins

A `Jenkinsfile` is included at the project root. It installs dependencies, runs tests, builds the app, and archives the `dist/` artifacts.

If your deployment uses AWS SES for email, configure the following environment variables in Jenkins:

- `SES_REGION`
- `SES_VERIFIED_SENDER` (defaults to `sudhir.22sep@gmail.com` when not set)

Build command:

```bash
npm install
npm run build
```

Serve the built SSR application with:

```bash
npm run serve:ssr:Nizam
```

### Docker

A `Dockerfile` is included for containerized deployment. Build and run with:

```bash
docker build -t nizam-app .
docker run -p 4200:4200 -e SES_REGION=your-region -e SES_VERIFIED_SENDER=sudhir.22sep@gmail.com nizam-app
```

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.

- ARKit preview features are being prepared and will be available soon for supported iOS devices.
