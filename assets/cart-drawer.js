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
    
    // Add delegated listener for selling plan dropdown changes
    this.addEventListener('change', this.#handleSellingPlanChange);

    if (this.#themeDrawer?.hasAttribute('open')) {
      this.#handleDrawerOpen();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);
    this.#themeDrawer?.removeEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
    this.removeEventListener('change', this.#handleSellingPlanChange);
  }

  /**
   * Handles selling plan dropdown changes, aborts rapid clicks, and re-renders only affected regions[cite: 1].
   * @param {Event} event
   */
  #handleSellingPlanChange = async (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    
    // Only intercept our specific subscription dropdowns
    if (!select.classList.contains('cart-item__selling-plan-select')) return;

    // The wrapper should contain the line item key and current quantity
    const wrapper = select.closest('[data-line-key]');
    if (!wrapper) return;

    const lineKey = wrapper.getAttribute('data-line-key');
    const quantity = wrapper.getAttribute('data-quantity');
    const newSellingPlanId = select.value;

    // Debounce: Abort previous in-flight requests if user clicks rapidly[cite: 1]
    if (this.#abortController) {
      this.#abortController.abort();
    }
    this.#abortController = new AbortController();

    // Set UI to loading state
    select.disabled = true;
    const spinner = wrapper.querySelector('.cart-item__selling-plan-spinner');
    if (spinner) spinner.removeAttribute('hidden');

    try {
      const sectionId = this.closest('.shopify-section')?.id.replace('shopify-section-', '') || 'cart-drawer';

      // Use native Fetch instead of CartLinesUpdateEvent to strictly control partial DOM replacement[cite: 1]
      const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart/change.js`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        signal: this.#abortController.signal,
        body: JSON.stringify({
          id: lineKey,
          quantity: quantity, 
          selling_plan: newSellingPlanId || null,
          sections: sectionId
        })
      });

      if (!response.ok) throw new Error('Failed to update selling plan');

      const state = await response.json();
      const updatedSectionHtml = state.sections[sectionId];

      if (updatedSectionHtml) {
        const dom = new DOMParser().parseFromString(updatedSectionHtml, 'text/html');

        // 1. Re-render ONLY the specific line item[cite: 1]
        const currentLineItem = select.closest('.cart-item') || select.closest('tr');
        if (currentLineItem && currentLineItem.id) {
          const newLineItem = dom.getElementById(currentLineItem.id);
          if (newLineItem) {
            currentLineItem.innerHTML = newLineItem.innerHTML;
          }
        }

        // 2. Re-render the summary/footer to reflect cart-level discount recalculations[cite: 1]
        const currentSummary = this.querySelector('.cart-drawer__summary, .cart__footer');
        if (currentSummary) {
          // Identify the exact class or ID of the summary to find its match in the new DOM
          const selector = currentSummary.id ? `#${currentSummary.id}` : `.${currentSummary.className.split(' ').join('.')}`;
          const newSummary = dom.querySelector(selector);
          
          if (newSummary) {
            currentSummary.innerHTML = newSummary.innerHTML;
          }
        }

        // Ensure the drawer layout recalibrates after DOM injection
        this.#updateStickyState();
      }

    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('[cart-drawer] Selling plan update error:', error);
      }
    } finally {
      // Restore UI state only if a newer request hasn't overridden this one
      if (!this.#abortController.signal.aborted) {
        select.disabled = false;
        if (spinner) spinner.setAttribute('hidden', '');
      }
    }
  };

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