import { NgModule, PLATFORM_ID, Inject } from '@angular/core';
import { BrowserModule, BrowserTransferStateModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { TransferHttpCacheModule } from '@angular/common/http';
import { isPlatformServer, isPlatformBrowser } from '@angular/common';
import { environment } from '../environments/environment';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { APP_BASE_HREF } from '@angular/common';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    // BrowserModule with server transition enables Angular Universal to bootstrap
    BrowserModule.withServerTransition({ appId: 'my-app' }),
    BrowserTransferStateModule,
    HttpClientModule,
    TransferHttpCacheModule,
    AppRoutingModule
  ],
  providers: [
    // Provide the base href for both browser and server
    { provide: APP_BASE_HREF, useValue: '/' },
    // Example of a server‑only provider
    {
      provide: 'SERVER_ONLY_SERVICE',
      useFactory: (platformId: Object) => {
        if (isPlatformServer(platformId)) {
          // Import a server‑only service lazily
          const { ServerOnlyService } = require('./server-only.service');
          return new ServerOnlyService();
        }
        return null;
      },
      deps: [PLATFORM_ID]
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {
  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    // Enable production mode on the server
    if (environment.production && isPlatformServer(this.platformId)) {
      // Angular's enableProdMode is usually called in main.ts, but we guard it here
      // to ensure it runs on the server side.
      // import { enableProdMode } from '@angular/core';
      // enableProdMode();
    }
  }
}
