import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';
import { Capacitor } from '@capacitor/core';
import { ToastService } from '../../services/toast.service';

/** Brand navy used for the Android status bar and the iOS splash background. */
const BRAND_NAVY = '#14263D';

/**
 * NativeShellService — owns everything that only makes sense inside the native
 * shell: status bar, keyboard resizing, connectivity, and back navigation.
 *
 * Every plugin call is wrapped in a platform guard plus a try/catch. The same
 * components are also compiled for the browser build (and unit-tested under
 * jsdom, where no plugin is registered), so an unguarded call would throw at
 * bootstrap. Failures degrade silently rather than blocking the storefront.
 */
@Injectable({ providedIn: 'root' })
export class NativeShellService {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** True only on a real iOS/Android device build. */
  readonly isNative = Capacitor.isNativePlatform();

  /**
   * Applies the native chrome. Called once from the mobile app root's
   * constructor, before the first page paints.
   */
  async init(): Promise<void> {
    if (!this.isNative) {
      return;
    }

    await Promise.allSettled([this.configureStatusBar(), this.configureKeyboard()]);

    void this.watchConnectivity();
  }

  /**
   * Draws the status bar to match the app's navy header.
   *
   * On Android the bar is drawn over the WebView, so `Style.Light` (light
   * content) keeps the white icons readable on navy. iOS ignores the style and
   * uses the bar config in Info.plist / capacitor.config.ts.
   */
  private async configureStatusBar(): Promise<void> {
    try {
      // `Style.Light` means light *content* (white icons), not a white bar —
      // which is what we want against the dark navy header.
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setBackgroundColor({ color: BRAND_NAVY });
      // The header paints under the status bar so the notch area is filled.
      await StatusBar.setOverlaysWebView({ overlay: true });
    } catch {
      // Android-only APIs (setBackgroundColor/setOverlaysWebView) reject on iOS.
    }
  }

  /**
   * Resizes the WebView when the software keyboard opens.
   *
   * Native form inputs (the login, register, address and checkout forms) sit in
   * the bottom half of the screen, so the page must shrink and scroll rather
   * than hide the field being typed into.
   */
  private async configureKeyboard(): Promise<void> {
    try {
      await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    } catch {
      // Older iOS versions do not expose resize modes.
    }
  }

  /**
   * Warns the shopper when the connection drops.
   *
   * The catalog is fetched over the network, so a silent failure looks like an
   * empty store. One toast on transition is enough — no polling.
   */
  private async watchConnectivity(): Promise<void> {
    try {
      const status = await Network.getStatus();
      if (!status.connected) {
        this.toast.show('You are offline. Showing saved products.', 'warning');
      }

      await Network.addListener('networkStatusChange', (next) => {
        if (next.connected) {
          this.toast.show('Back online.', 'success');
        }
      });
    } catch {
      // Network plugin unavailable; the app still works, just without hints.
    }
  }

  /** Closes the software keyboard after a successful submit. */
  async dismissKeyboard(): Promise<void> {
    try {
      await Keyboard.hide();
    } catch {
      // Nothing to hide.
    }
  }

  /**
   * Back button behaviour for the native header.
   *
   * Prefers real history so the shopper returns to the screen they came from
   * (e.g. product -> cart -> product). `fallback` covers the cold deep-link
   * case, where there is no in-app history and history.back() would otherwise
   * leave the app entirely.
   */
  goBack(fallback = '/'): void {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    void this.router.navigateByUrl(fallback);
  }
}