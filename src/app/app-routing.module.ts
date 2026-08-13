import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

/**
 * Root routing module.
 *
 * The routes are defined with a `resolve` guard that can perform
 * server‑side data fetching using `ApiResolver` when running on the server.
 */
const routes: Routes = [
  {
    path: '',
    redirectTo: '/home',
    pathMatch: 'full'
  },
  {
    path: 'home',
    loadChildren: () => import('../features/home/home.module').then(m => m.HomeModule)
  },
  {
    path: '**',
    redirectTo: '/home'
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {
    // Enables Angular Universal to preserve the URL during server-side navigation
    initialNavigation: 'enabled',
    // Use `firstEmptyPathMatch` strategy for lazy-loaded routes
    preloadingStrategy: undefined
  })],
  exports: [RouterModule]
})
export class AppRoutingModule {}