import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events'; // <-- Imported shared state events

if (!customElements.get('cart-drawer-upsell')) {
  class CartDrawerUpsell extends Component {
    connectedCallback() {
      this.handleCartChange = this.handleCartChange.bind(this);
      
      // Listen to the shared state layer for cart updates
      document.addEventListener(StandardEvents.cartLinesUpdate, this.handleCartChange);
    }

    disconnectedCallback() {
      // Clean up the listener to prevent memory leaks
      document.removeEventListener(StandardEvents.cartLinesUpdate, this.handleCartChange);
    }

    handleCartChange(event) {
      // Wait for the native cart update to fully complete before fetching new upsells
      event.promise
        .then(async ({ detail }) => {
          // If the cart update failed (e.g., out of stock), don't refresh the upsell
          if (detail?.didError) return;

          try {
            // Note: For better performance, consider appending '?section_id=cart-drawer' 
            // (or your actual section ID) so you don't fetch the entire page HTML.
            const response = await fetch(`${window.location.pathname}`);
            const htmlText = await response.text();
            
            const dom = new DOMParser().parseFromString(htmlText, 'text/html');
            const newUpsellContent = dom.querySelector('[ref="upsellContent"]');
            
            if (newUpsellContent) {
              const currentContent = this.querySelector('[ref="upsellContent"]');
              if (currentContent) {
                currentContent.innerHTML = newUpsellContent.innerHTML;
              }
            }
          } catch (error) {
            console.error('Failed to update cart drawer upsell:', error);
          }
        })
        .catch((error) => {
          if (error?.name !== 'AbortError') {
            console.warn('Cart Drawer Upsell fetch aborted or failed:', error);
          }
        });
    }
  }
  
  customElements.define('cart-drawer-upsell', CartDrawerUpsell);
}