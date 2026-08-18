import { Component } from '@theme/component';
import {
  fetchConfig,
  debounce,
  onAnimationEnd,
  prefersReducedMotion,
  resetShimmer,
  startViewTransition,
} from '@theme/utilities';
import { morphSection, sectionRenderer } from '@theme/section-renderer';
import { ThemeEvents, QuantitySelectorUpdateEvent } from '@theme/events';
import { cartPerformance } from '@theme/performance';
import {
  createViewEventElement,
  CartErrorEvent,
  CartDiscountUpdateEvent,
  CartLinesUpdateEvent,
  CartNoteUpdateEvent,
  StandardEvents,
} from '@shopify/events';

/** @typedef {import('./utilities').TextComponent} TextComponent */

/**
 * A custom element that displays a cart items component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} quantitySelectors - The quantity selector elements.
 * @property {HTMLTableRowElement[]} cartItemRows - The cart item rows.
 * @property {TextComponent} cartTotal - The cart total.
 *
 * @extends {Component<Refs>}
 */
export class CartItemsComponent extends createViewEventElement(Component) {
  #debouncedOnChange = debounce(
    /** @param {Event} event */
    (event) => {
      if (event instanceof QuantitySelectorUpdateEvent) this.#onQuantityChange(event);
    },
    300
  );
  
  /** @type {Promise<any> | null} */
  #pendingCartFetch = null;

  /** @type {AbortController | null} */
  #abortController = null;

  /**
   * True when the event was dispatched from outside this cart-items-component.
   * @param {Event} event
   */
  #isExternalCartUpdate(event) {
    return !(event.target instanceof Node) || !this.contains(event.target);
  }

  /** @param {CartDiscountUpdateEvent} event */
  #handleDiscountUpdate = (event) => {
    const external = this.#isExternalCartUpdate(event);
    event.promise
      ?.then(({ detail }) => {
        const sectionsHtml = detail?.sections?.[this.sectionId];
        if (sectionsHtml) {
          morphSection(this.sectionId, sectionsHtml, { mode: this.isDrawer ? 'hydration' : 'full' });
          this.#updateCartQuantitySelectorButtonStates();
        } else if (external) {
          sectionRenderer.renderSection(this.sectionId, {
            cache: false,
            mode: this.isDrawer ? 'hydration' : 'full',
          });
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[cart-items] Event promise rejected:', error);
      });
  };

  /** @param {CartNoteUpdateEvent} event */
  #handleNoteUpdate = (event) => {
    if (!this.#isExternalCartUpdate(event)) return;
    event.promise
      ?.then(({ detail }) => {
        const sections = /** @type {Record<string, string> | undefined} */ (detail?.sections);
        const sectionsHtml = sections?.[this.sectionId];
        if (sectionsHtml) {
          morphSection(this.sectionId, sectionsHtml, { mode: this.isDrawer ? 'hydration' : 'full' });
        } else {
          sectionRenderer.renderSection(this.sectionId, {
            cache: false,
            mode: this.isDrawer ? 'hydration' : 'full',
          });
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[cart-items] Event promise rejected:', error);
      });
  };

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    document.addEventListener(StandardEvents.cartDiscountUpdate, this.#handleDiscountUpdate);
    document.addEventListener(StandardEvents.cartNoteUpdate, this.#handleNoteUpdate);
    
    // Listen for selling plan changes natively within the component[cite: 4]
    this.addEventListener('change', this.#handleSellingPlanChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
    document.removeEventListener(StandardEvents.cartDiscountUpdate, this.#handleDiscountUpdate);
    document.removeEventListener(StandardEvents.cartNoteUpdate, this.#handleNoteUpdate);
    
    this.removeEventListener('change', this.#handleSellingPlanChange);
  }

  /**
   * Handles selling plan dropdown changes, triggering the update process[cite: 4].
   * @param {Event} event - The change event.
   */
  #handleSellingPlanChange = (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    if (!select.classList.contains('cart-item__selling-plan-select')) return;

    // Find the cart item row which stores the line item key[cite: 4]
    const row = select.closest('[data-key]');
    if (!row) return;

    const lineId = row.getAttribute('data-key');
    if (!lineId) return;

    // Ensure we send the current quantity to preserve it[cite: 4]
    const quantityInput = /** @type {HTMLInputElement | null} */ (row.querySelector('input[name="quantity"]'));
    const quantity = quantityInput ? parseInt(quantityInput.value, 10) : 1;
    const sellingPlan = select.value;

    this.updateSellingPlan({ id: lineId, quantity, sellingPlan, select });
  };

  /**
   * Updates the selling plan for a cart line item utilizing Horizon's native morph capabilities[cite: 4].
   * @param {Object} config
   * @param {string} config.id - The line item key.
   * @param {number} config.quantity - The current quantity.
   * @param {string} config.sellingPlan - The new selling plan ID.
   * @param {HTMLSelectElement} config.select - The dropdown element.
   */
  updateSellingPlan({ id, quantity, sellingPlan, select }) {
    // Abort rapid clicks to prevent cart corruption[cite: 4]
    if (this.#abortController) {
      this.#abortController.abort();
    }
    this.#abortController = new AbortController();

    const cartPerformaceUpdateMarker = cartPerformance.createStartingMarker(`update:user-action`);
    this.#disableCartItems();
    const { cartTotal } = this.refs;

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionsToUpdate = new Set([this.sectionId]);
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        sectionsToUpdate.add(item.dataset.sectionId);
      }
    });

    const body = JSON.stringify({
      id,
      quantity,
      selling_plan: sellingPlan || null,
      sections: Array.from(sectionsToUpdate).join(','),
      sections_url: window.location.pathname,
    });

    cartTotal?.shimmer();
    select.disabled = true;

    const deferredUpdatePromise = CartLinesUpdateEvent.createPromise();
    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'update',
        context: 'cart',
        lines: [{ id, quantity }],
        promise: deferredUpdatePromise.promise,
      })
    );

    // Fetch using Horizon's native fetchConfig and pass the AbortSignal[cite: 4]
    fetch(`${Theme.routes.cart_change_url}`, {
      ...fetchConfig('json', { body }),
      signal: this.#abortController.signal
    })
      .then((response) => response.text())
      .then((responseText) => {
        const parsedResponseText = JSON.parse(responseText);
        resetShimmer(this);

        if (parsedResponseText.errors) {
          deferredUpdatePromise.reject(new Error(parsedResponseText.errors));
          return;
        }

        const newSectionHTML = new DOMParser().parseFromString(
          parsedResponseText.sections[this.sectionId],
          'text/html'
        );

        const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
        const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

        this.#updateQuantitySelectors(parsedResponseText);

        deferredUpdatePromise.resolve({
          cart: CartLinesUpdateEvent.createCartFromAjaxResponse(parsedResponseText),
          detail: {
            sections: parsedResponseText.sections,
            items: parsedResponseText.items,
            itemCount: newCartItemCount,
            source: 'cart-items-component',
            didError: false,
          },
        });

        // Use morphSection to surgically replace ONLY the affected line item and totals[cite: 4]
        morphSection(this.sectionId, parsedResponseText.sections[this.sectionId], {
          mode: this.isDrawer ? 'hydration' : 'full',
        });

        this.#updateCartQuantitySelectorButtonStates();
      })
      .catch((error) => {
        // Ignore aborted errors from rapid clicks[cite: 4]
        if (error.name === 'AbortError') return;
        
        console.error(error);
        deferredUpdatePromise.reject(error);
        this.dispatchEvent(
          new CartErrorEvent({
            error: error?.message || 'Failed to update selling plan',
            code: 'SERVICE_UNAVAILABLE',
          })
        );
      })
      .finally(() => {
        // Only enable if the request wasn't overridden by a newer one[cite: 4]
        if (!this.#abortController?.signal.aborted) {
          this.#enableCartItems();
          select.disabled = false;
          cartPerformance.measureFromMarker(cartPerformaceUpdateMarker);
        }
      });
  }

  /**
   * Handles QuantitySelectorUpdateEvent change event.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  #onQuantityChange(event) {
    if (!(event.target instanceof Node) || !this.contains(event.target)) return;

    const { quantity, cartLine: line } = event.detail;
    if (!line) return;

    if (quantity === 0) {
      return this.onLineItemRemove(line);
    }

    this.updateQuantity({
      line,
      quantity,
      action: 'change',
    });
    const lineItemRow = this.refs.cartItemRows[line - 1];

    if (!lineItemRow) return;

    const textComponent = /** @type {TextComponent | undefined} */ (lineItemRow.querySelector('text-component'));
    textComponent?.shimmer();
  }

  /**
   * Handles the line item removal.
   * @param {number} line - The line item index.
   */
  onLineItemRemove(line) {
    this.updateQuantity({
      line,
      quantity: 0,
      action: 'clear',
    });

    const cartItemRowToRemove = this.refs.cartItemRows[line - 1];
    if (!cartItemRowToRemove) return;

    const rowsToRemove = [
      cartItemRowToRemove,
      ...this.refs.cartItemRows.filter((row) => row.dataset.parentKey === cartItemRowToRemove.dataset.key),
    ];

    const isEmptyCart = rowsToRemove.length == this.refs.cartItemRows.length;
    const template = document.getElementById('empty-cart-template');
    
    if (isEmptyCart && template instanceof HTMLTemplateElement) {
      const clone = document.importNode(template.content, true);

      startViewTransition(() => {
        document.getElementById('cart-drawer-heading')?.remove();
        this.replaceChildren(clone);
      }, [this.isDrawer ? 'empty-cart-drawer' : 'empty-cart-page']);

      return;
    }

    rowsToRemove.forEach((row) => {
      const remove = () => row.remove();
      if (prefersReducedMotion()) return remove();

      row.style.setProperty('--row-height', `${row.clientHeight}px`);
      row.classList.add('removing');
      onAnimationEnd(row, remove);
    });
  }

  /**
   * Updates the quantity.
   * @param {Object} config - The config.
   * @param {number} config.line - The line.
   * @param {number} config.quantity - The quantity.
   * @param {string} config.action - The action.
   */
  updateQuantity(config) {
    const cartPerformaceUpdateMarker = cartPerformance.createStartingMarker(`${config.action}:user-action`);

    this.#disableCartItems();

    const { line, quantity } = config;
    const { cartTotal } = this.refs;

    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionsToUpdate = new Set([this.sectionId]);
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        sectionsToUpdate.add(item.dataset.sectionId);
      }
    });

    const body = JSON.stringify({
      line: line,
      quantity: quantity,
      sections: Array.from(sectionsToUpdate).join(','),
      sections_url: window.location.pathname,
    });

    cartTotal?.shimmer();

    const deferredUpdatePromise = CartLinesUpdateEvent.createPromise();
    const lineId = this.refs.cartItemRows[line - 1]?.dataset.key ?? '';
    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: config.action === 'change' && quantity > 0 ? 'update' : 'remove',
        context: 'cart',
        lines: [{ id: lineId, quantity }],
        promise: deferredUpdatePromise.promise,
      })
    );

    fetch(`${Theme.routes.cart_change_url}`, fetchConfig('json', { body }))
      .then((response) => response.text())
      .then((responseText) => {
        const parsedResponseText = JSON.parse(responseText);

        resetShimmer(this);

        if (parsedResponseText.errors) {
          this.#handleCartError(line, parsedResponseText);
          deferredUpdatePromise.reject(new Error(parsedResponseText.errors));
          return;
        }

        const newSectionHTML = new DOMParser().parseFromString(
          parsedResponseText.sections[this.sectionId],
          'text/html'
        );

        const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
        const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

        this.#updateQuantitySelectors(parsedResponseText);

        deferredUpdatePromise.resolve({
          cart: CartLinesUpdateEvent.createCartFromAjaxResponse(parsedResponseText),
          detail: {
            sections: parsedResponseText.sections,
            items: parsedResponseText.items,
            itemCount: newCartItemCount,
            source: 'cart-items-component',
            didError: false,
          },
        });

        morphSection(this.sectionId, parsedResponseText.sections[this.sectionId], {
          mode: this.isDrawer ? 'hydration' : 'full',
        });

        this.#updateCartQuantitySelectorButtonStates();
      })
      .catch((error) => {
        console.error(error);
        deferredUpdatePromise.reject(error);

        this.dispatchEvent(
          new CartErrorEvent({
            error: error?.message || 'Failed to update cart',
            code: 'SERVICE_UNAVAILABLE',
          })
        );
      })
      .finally(() => {
        this.#enableCartItems();
        cartPerformance.measureFromMarker(cartPerformaceUpdateMarker);
      });
  }

  /**
   * Handles the cart error.
   * @param {number} line - The line.
   * @param {Object} parsedResponseText - The parsed response text.
   * @param {string} parsedResponseText.errors - The errors.
   */
  #handleCartError = (line, parsedResponseText) => {
    const quantitySelector = this.refs.quantitySelectors[line - 1];
    const quantityInput = quantitySelector?.querySelector('input');

    if (!quantityInput) throw new Error('Quantity input not found');

    quantityInput.value = quantityInput.defaultValue;

    const cartItemError = this.refs[`cartItemError-${line}`];
    const cartItemErrorContainer = this.refs[`cartItemErrorContainer-${line}`];

    if (!(cartItemError instanceof HTMLElement)) throw new Error('Cart item error not found');
    if (!(cartItemErrorContainer instanceof HTMLElement)) throw new Error('Cart item error container not found');

    cartItemError.textContent = parsedResponseText.errors;
    cartItemErrorContainer.classList.remove('hidden');

    this.dispatchEvent(
      new CartErrorEvent({
        error: parsedResponseText.errors || 'Cart update failed',
        code: 'INVALID',
      })
    );
  };

  /**
   * Handles the cart update.
   *
   * @param {CartLinesUpdateEvent} event
   */
  #handleCartUpdate = (event) => {
    if (event.target === this) return;

    event.promise
      ?.then(async ({ detail }) => {
        const sections = detail?.sections;
        const cartItemsHtml = sections?.[this.sectionId];
        const wasEmptyCartDrawer = this.isDrawer && this.querySelector('[data-cart-drawer-empty]') !== null;
        /** @type {'hydration' | 'full'} */
        const mode = this.isDrawer ? 'hydration' : 'full';
        const morphOptions = {
          mode,
          injectStylesheet: wasEmptyCartDrawer,
        };

        if (cartItemsHtml) {
          const existingKeys = new Set(this.refs.cartItemRows?.map((row) => row.dataset.key) ?? []);

          if (wasEmptyCartDrawer) {
            startViewTransition(() => {
              morphSection(this.sectionId, cartItemsHtml, morphOptions);
            }, ['fill-cart-drawer']);
          } else {
            await morphSection(this.sectionId, cartItemsHtml, morphOptions);
          }

          if (!wasEmptyCartDrawer && !prefersReducedMotion()) {
            for (const row of this.refs.cartItemRows ?? []) {
              if (!existingKeys.has(row.dataset.key)) {
                row.classList.add('adding');
                onAnimationEnd(row, () => row.classList.remove('adding'));
              }
            }
          }

          this.#updateCartQuantitySelectorButtonStates();
        } else {
          sectionRenderer.renderSection(this.sectionId, { cache: false, ...morphOptions });
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[cart-items] Event promise rejected:', error);
      });
  };

  /**
   * Disables the cart items.
   */
  #disableCartItems() {
    this.classList.add('cart-items-disabled');
  }

  /**
   * Enables the cart items.
   */
  #enableCartItems() {
    this.classList.remove('cart-items-disabled');
  }

  /**
   * Updates quantity selectors for all matching variants in the cart.
   * @param {Object} updatedCart - The updated cart object.
   * @param {Array<{variant_id: number, quantity: number}>} [updatedCart.items] - The cart items.
   */
  #updateQuantitySelectors(updatedCart) {
    if (!updatedCart.items) return;

    for (const item of updatedCart.items) {
      const variantId = item.variant_id.toString();
      const selectors = document.querySelectorAll(`quantity-selector-component[data-variant-id="${variantId}"]`);

      for (const selector of selectors) {
        const input = selector.querySelector('input[data-cart-quantity]');
        if (!input) continue;

        input.setAttribute('data-cart-quantity', item.quantity.toString());

        if ('updateCartQuantity' in selector && typeof selector.updateCartQuantity === 'function') {
          selector.updateCartQuantity();
        }
      }
    }
  }

  /**
   * Updates button states for all cart quantity selector components.
   */
  #updateCartQuantitySelectorButtonStates() {
    for (const selector of document.querySelectorAll('cart-quantity-selector-component')) {
      /** @type {any} */ (selector).updateButtonStates?.();
    }
  }

  async fetchCartData() {
    if (this.#pendingCartFetch) return this.#pendingCartFetch;

    this.#pendingCartFetch = (async () => {
      const response = await fetch(`${Theme.routes.cart_url}.json`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Failed to fetch cart: ${response.status} ${response.statusText}`);
      const data = await response.json();
      return data;
    })().finally(() => {
      this.#pendingCartFetch = null;
    });

    return this.#pendingCartFetch;
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error('Section id missing');

    return sectionId;
  }

  /**
   * @returns {boolean} Whether the component is a drawer.
   */
  get isDrawer() {
    return this.dataset.drawer !== undefined;
  }
}

if (!customElements.get('cart-items-component')) {
  customElements.define('cart-items-component', CartItemsComponent);
}