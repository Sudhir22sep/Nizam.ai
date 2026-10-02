import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptorsFromDi
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MobileApiInterceptor } from './mobile-api.interceptor';
import { environment } from '../../../environments/environment';

describe('MobileApiInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let apiUrl: string;

  beforeEach(() => {
    apiUrl = environment.apiUrl;

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: MobileApiInterceptor, multi: true }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // Every shared service calls a relative '/api/...' path. Inside the WebView
  // that would resolve against capacitor://localhost, so rewriting is what makes
  // the storefront work on device at all.
  it('rewrites a relative /api request onto the absolute API origin', () => {
    http.get('/api/products').subscribe();

    const request = httpMock.expectOne(req => req.url === `${apiUrl}/api/products`);
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('preserves the path, query string and HTTP method when rewriting', () => {
    http.get('/api/orders?limit=10').subscribe();

    const request = httpMock.expectOne(req => req.url === `${apiUrl}/api/orders?limit=10`);
    expect(request.request.url).toContain('limit=10');
    request.flush({});
  });

  it('keeps non-API relative requests untouched', () => {
    http.get('/images/products/placeholder.svg').subscribe();

    const request = httpMock.expectOne('/images/products/placeholder.svg');
    expect(request.request.url).toBe('/images/products/placeholder.svg');
    request.flush('');
  });

  it('passes already-absolute URLs through, so CDN and gateway calls are not rewritten', () => {
    http.get('https://checkout.razorpay.com/v1/checkout.js').subscribe();

    const request = httpMock.expectOne('https://checkout.razorpay.com/v1/checkout.js');
    expect(request.request.url).toBe('https://checkout.razorpay.com/v1/checkout.js');
    request.flush('');
  });

  it('rewrites POST bodies without altering the payload', () => {
    const payload = { email: 'shopper@example.com', password: 'secret' };
    http.post('/api/login', payload).subscribe();

    const request = httpMock.expectOne(req => req.url === `${apiUrl}/api/login`);
    expect(request.request.body).toEqual(payload);
    request.flush({ success: true });
  });

  // A URL such as '/apixyz' must not match: the guard is the '/api' prefix,
  // not a loose contains().
  it('does not rewrite paths that merely start with the same characters', () => {
    http.get('/apixyz/status').subscribe();

    const request = httpMock.expectOne('/apixyz/status');
    expect(request.request.url).toBe('/apixyz/status');
    request.flush({});
  });
});
