import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events';

if (!customElements.get('dynamic-stitch')) {
  class DynamicStitch extends Component {
    connectedCallback() {
      console.log('0. Dynamic Stitch component loaded');
      this.swatches = this.querySelectorAll('.stitch-selector__swatch');
      
      this.swatches.forEach(swatch => {
        swatch.addEventListener('click', this.handleStitch.bind(this));
      });

      if (!window.stitchPopStateBound) {
        window.addEventListener('popstate', this.handlePopState.bind(this));
        window.stitchPopStateBound = true;
      }
      this.syncActiveState = this.syncActiveState.bind(this);
      document.addEventListener(StandardEvents.productSelect, this.syncActiveState);
    }

    disconnectedCallback() {
      document.removeEventListener(StandardEvents.productSelect, this.syncActiveState);
    }

    async handleStitch(e) {
      e.preventDefault();
      console.log('1. Swatch clicked!');
      
      const swatch = e.currentTarget;
      if (swatch.classList.contains('is-active')) {
        console.log('1b. Swatch is already active, ignoring.');
        return;
      }

      const url = swatch.dataset.stitchUrl || swatch.getAttribute('href');
      console.log('2. Fetching URL:', url);
      
      swatch.classList.add('is-loading');
      const spinner = swatch.querySelector('.stitch-selector__spinner');
      if (spinner) spinner.hidden = false;

      // Check if we are inside a Quick View modal
      const quickViewModal = this.closest('.quick-view__content-target');
      const shouldUpdateHistory = !quickViewModal && true;

      await this.swapProduct(url, shouldUpdateHistory);
    }

    async handlePopState() {
      await this.swapProduct(window.location.pathname, false);
    }

    // Built-in subscription sync method inside the class
    #initSellingPlanSync(container) {
      const form = container.querySelector('form[action*="/cart/add"]');
      if (!form) return;

      let sellingPlanInput = form.querySelector('input[name="selling_plan"]');
      if (!sellingPlanInput) {
        sellingPlanInput = document.createElement('input');
        sellingPlanInput.type = 'hidden';
        sellingPlanInput.name = 'selling_plan';
        form.appendChild(sellingPlanInput);
      }

      const updateSellingPlan = () => {
        const activeRadio = container.querySelector('input[name^="purchaseOption"]:checked');
        if (!activeRadio) return;

        if (activeRadio.dataset.radioType === 'one_time_purchase') {
          sellingPlanInput.value = '';
        } else if (activeRadio.dataset.radioType === 'selling_plan_group') {
          const groupId = activeRadio.dataset.sellingPlanGroupId;
          const dropdown = container.querySelector(`select.group_dropdown[data-selling-plan-group-id="${groupId}"]`);
          
          if (dropdown) {
            sellingPlanInput.value = dropdown.value;
          } else {
            sellingPlanInput.value = activeRadio.dataset.sellingPlanId || '';
          }
        }
      };

      container.querySelectorAll('input[name^="purchaseOption"]').forEach(radio => {
        radio.addEventListener('change', updateSellingPlan);
      });

      container.querySelectorAll('select.group_dropdown').forEach(select => {
        select.addEventListener('change', (e) => {
          const groupId = e.target.dataset.sellingPlanGroupId;
          const associatedRadio = container.querySelector(`input[data-selling-plan-group-id="${groupId}"]`);
          if (associatedRadio) associatedRadio.checked = true;
          updateSellingPlan();
        });
      });

      updateSellingPlan();
    }

    async swapProduct(url, updateHistory) {
      try {
        const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}view=quick-view`);
        if (!response.ok) throw new Error(`Fetch failed with status: ${response.status}`);
        
        const htmlText = await response.text();
        const dom = new DOMParser().parseFromString(htmlText, 'text/html');
        
        const newProductComponent = dom.querySelector('.product-information product-component') || dom.querySelector('product-component');
        if (!newProductComponent) throw new Error('Could not find product-component in the fetched response');

        // Check if we are swapping inside a Quick View modal
        const quickViewModal = this.closest('quick-view');
        const quickViewContentTarget = this.closest('.quick-view__content-target');

        let currentComponent;
        if (quickViewContentTarget) {
          currentComponent = quickViewContentTarget.querySelector('.product-information product-component') || quickViewContentTarget.querySelector('product-component');
        } else {
          currentComponent = document.querySelector('.product-information product-component');
        }

        if (!currentComponent) throw new Error('Could not find product-component to replace');

        // Replace main component
        currentComponent.replaceWith(newProductComponent);

        // === NEW: Update Sticky Add To Cart ===
        // Only attempt to update the sticky add-to-cart if we are on the main page (not in a Quick View modal)
        if (!quickViewModal) {
          // Adjust these selectors if your theme uses a different class/tag for the sticky add-to-cart
          const newStickyCart = dom.querySelector('sticky-add-to-cart') || dom.querySelector('.sticky-add-to-cart');
          const currentStickyCart = document.querySelector('sticky-add-to-cart') || document.querySelector('.sticky-add-to-cart');
          
          if (newStickyCart && currentStickyCart) {
            currentStickyCart.replaceWith(newStickyCart);
          }
        }
        // ======================================

        // Re-execute scripts for the new product
        const targetScope = quickViewContentTarget || document;
        const injectedComponent = targetScope.querySelector('product-component');
        if (injectedComponent) {
          injectedComponent.querySelectorAll('script').forEach(oldScript => {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            oldScript.parentNode.replaceChild(newScript, oldScript);
          });
        }

        // UNIVERSAL METHOD: Re-run subscription sync using the class's built-in method for both Quick View and PDP
        if (quickViewModal && typeof quickViewModal.initSellingPlanSync === 'function') {
          quickViewModal.initSellingPlanSync(targetScope);
        } else {
          this.#initSellingPlanSync(targetScope);
        }

        if (updateHistory && !quickViewModal && window.location.pathname !== url) {
          const newTitle = dom.querySelector('title')?.textContent || '';
          document.title = newTitle;
          window.history.pushState({ path: url }, newTitle, url);
        }

        await this.syncActiveState(quickViewContentTarget, url);

      } catch (error) {
        console.error('Dynamic Stitch Failed at step:', error);
      }
    }

    async syncActiveState(quickViewContentTarget, url) {
      // Refresh active swatches state
      const scopeContainer = quickViewContentTarget?.target || quickViewContentTarget || document;
      scopeContainer.querySelectorAll('.stitch-selector__swatch').forEach(s => {
        s.classList.remove('is-active', 'is-loading');
        const sp = s.querySelector('.stitch-selector__spinner');
        if (sp) sp.hidden = true;
        
        if (s.dataset.stitchUrl === url || s.getAttribute('href') === url) {
          s.classList.add('is-active');
        }
      });
    }
  }
  customElements.define('dynamic-stitch', DynamicStitch);
}