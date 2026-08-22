import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events';
import { DrawerOpenEvent } from '@theme/theme-drawer';

/**
 * A custom element that manages cart drawer behavior within a `<theme-drawer>`.
 *
 * @extends {Component}
 */
class CartDrawerComponent extends Component {
  /** @type {number} */
  #summaryThreshold = 0.5;
  
  /** @type {AbortController | null} */
  #abortController = null;

  /** @type {import('@theme/theme-drawer').ThemeDrawer | null} */
  get #themeDrawer() {
    return /** @type {import('@theme/theme-drawer').ThemeDrawer | null} */ (this.closest('theme-drawer'));
  }

  /** @type {HTMLDialogElement | null} */
  get #dialog() {
    return this.closest('dialog');
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);
    this.#themeDrawer?.addEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
  
    if (this.#themeDrawer?.hasAttribute('open')) {
      this.#handleDrawerOpen();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);
    this.#themeDrawer?.removeEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
  }

  #handleDrawerOpen = () => {
    this.#updateStickyState();

    customElements.whenDefined('shopify-payment-terms').then(() => {
      const cta = this.querySelector('shopify-payment-terms')?.shadowRoot?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', () => this.#themeDrawer?.close(), { once: true });
    });
  };

  #handleCartLinesUpdate = (event) => {
    const shouldAutoOpen = this.hasAttribute('auto-open') && event.action === 'add' && !this.#themeDrawer?.isOpen;

    const sourceModal = /** @type {HTMLDialogElement | null} */ (
      event.target instanceof Element ? event.target.closest('dialog:modal') : null
    );

    if (shouldAutoOpen && !sourceModal && !this.#isCartEmpty()) {
      this.#themeDrawer?.open();
    }

    event.promise
      ?.then(({ detail }) => {
        const settle = () => requestAnimationFrame(() => this.#updateStickyState());

        if (!shouldAutoOpen || detail?.didError) {
          settle();
          return;
        }

        const openAndSettle = () => {
          if (!this.#themeDrawer?.isOpen) this.#themeDrawer?.open();
          settle();
        };

        if (sourceModal?.open) {
          sourceModal.addEventListener('close', openAndSettle, { once: true });
        } else {
          openAndSettle();
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[cart-drawer] Event promise rejected:', error);
      });
  };

  #isCartEmpty() {
    return Boolean(this.querySelector('.cart-drawer--empty'));
  }

  #updateStickyState() {
    const dialog = this.#dialog;
    if (!dialog) return;

    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
    if(document.querySelector('.quick-view__dialog[open]')) {
      document.querySelector('.quick-view__dialog[open]').close()
    }
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}