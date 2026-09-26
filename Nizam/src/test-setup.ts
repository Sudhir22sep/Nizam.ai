import '@analogjs/vitest-angular/setup-snapshots';

import { afterEach } from 'vitest';
import { getTestBed, TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// The app is zoneless (Angular 21 default), so zone.js/testing is deliberately
// NOT imported: it would re-introduce Zone.js and install a per-test reset that
// conflicts with the plugin's TestBed lifecycle. That means nothing else calls
// initTestEnvironment, so do it here exactly once. The guard covers the case
// where the plugin already did it, since calling twice throws.
if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
  );
}

// zone.js/testing normally resets the TestBed between tests. Without it, the
// module stays instantiated after the first test in a file and every later
// `configureTestingModule` throws "Cannot configure the test module when the test
// module has already been instantiated". `afterEach` (rather than `beforeEach`)
// keeps each test's own setup untouched — the specs configure the module and then
// create the fixture inside the same test.
afterEach(() => {
  TestBed.resetTestingModule();
});