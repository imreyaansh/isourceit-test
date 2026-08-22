import { Component } from '@theme/component';
import { StandardEvents } from '@shopify/events';

if (!customElements.get('quick-view')) {
  class QuickView extends Component {
    connectedCallback() {
      this.button = this.querySelector('.quick-view__button');
      this.dialog = this.querySelector('.quick-view__dialog');
      this.closeButton = this.querySelector('.quick-view__close');
      this.contentTarget = this.querySelector('.quick-view__content-target');
      this.productUrl = this.dataset.productUrl;
      this.isLoaded = false;
      
      if (!this.button || !this.dialog) return;
      
      // Bind events
      this.button.addEventListener('click', this.openModal.bind(this));
      this.closeButton.addEventListener('click', () => this.dialog.close());
      
      // Close on backdrop click
      this.dialog.addEventListener('click', (event) => {
        const rect = this.dialog.getBoundingClientRect();
        const isInDialog = (
          rect.top <= event.clientY &&
          event.clientY <= rect.bottom &&
          rect.left <= event.clientX &&
          event.clientX <= rect.right
        );

        event.stopPropagation();
        
        if (!isInDialog) {
          this.dialog.close();
        }
      });

      this.handleVariantChange = this.handleVariantChange.bind(this);
      document.addEventListener(StandardEvents.productSelect, this.handleVariantChange);
    }

    disconnectedCallback() {
      document.removeEventListener(StandardEvents.productSelect, this.handleVariantChange);
    }

    handleVariantChange(event) {
      // Only react if the variant change happened INSIDE this specific modal
      if (!this.contentTarget.contains(event.target)) return;
      
      event.promise.then(({ detail }) => {
        if (!detail) return;
        
        // The variant changed natively, so we re-sync the selling plan logic
        this.initSellingPlanSync(this.contentTarget);
      }).catch(error => {
        if (error?.name !== 'AbortError') console.warn(error);
      });
    }

    async openModal() {
      this.dialog.showModal();
      
      if (this.productUrl) {
        try {
          const response = await fetch(`${this.productUrl}${this.productUrl.includes('?') ? '&' : '?'}view=quick-view`);
          const htmlText = await response.text();
          
          const dom = new DOMParser().parseFromString(htmlText, 'text/html');
          const productComponent = dom.querySelector('product-component');
          
          if (productComponent) {
            // Prevent Form ID clashes for Selling Plan selectors
            const forms = productComponent.querySelectorAll('form');
            forms.forEach((form) => {
              if (form.id) {
                const oldId = form.id;
                const newId = `${oldId}-quickview-${Math.random().toString(36).substring(2, 9)}`;
                form.id = newId;
                productComponent.querySelectorAll(`[form="${oldId}"]`).forEach(el => {
                  el.setAttribute('form', newId);
                });
              }
            });

            this.contentTarget.innerHTML = '';
            this.contentTarget.appendChild(productComponent);
            this.isLoaded = true;

            // Boot up the native scripts
            this.contentTarget.querySelectorAll('script').forEach(oldScript => {
              const newScript = document.createElement('script');
              Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
              newScript.appendChild(document.createTextNode(oldScript.innerHTML));
              oldScript.parentNode.replaceChild(newScript, oldScript);
            });

            this.initSellingPlanSync(this.contentTarget);
          } else {
            this.contentTarget.innerHTML = '<div class="quick-view__loading">Product details not found.</div>';
          }
        } catch (error) {
          console.error('Quick view fetch error:', error);
          this.contentTarget.innerHTML = '<div class="quick-view__loading">Error loading product details.</div>';
        }
      }
    }

    initSellingPlanSync(container) {
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

      const radioButtons = container.querySelectorAll('input[name^="purchaseOption"]');
      radioButtons.forEach(radio => {
        radio.addEventListener('change', updateSellingPlan);
      });

      const dropdowns = container.querySelectorAll('select.group_dropdown');
      dropdowns.forEach(select => {
        select.addEventListener('change', (e) => {
          const groupId = e.target.dataset.sellingPlanGroupId;
          const associatedRadio = container.querySelector(`input[data-selling-plan-group-id="${groupId}"]`);
          if (associatedRadio) associatedRadio.checked = true;
          
          updateSellingPlan();
        });
      });

      updateSellingPlan();
    }
  }
  customElements.define('quick-view', QuickView);
}