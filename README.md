# Shopify Advanced Theme Features: Migration & Architecture Guide

This document outlines the architecture, flow, and dependencies for the advanced theme features implemented in this project. It is designed to serve as a comprehensive migration guide for developers porting these functionalities to another Shopify theme.

All features are built using modern **Vanilla JavaScript**, **Web Components (Custom Elements)**, and **Shopify's Section Rendering API**. This ensures maximum modularity and high performance without relying on heavy frontend frameworks (like jQuery or React).

---

## 📑 Table of Contents

1. [Feature 1: Smart Sticky Add to Cart](#feature-1-smart-sticky-add-to-cart)
2. [Feature 2: Quick Add Modal](#feature-2-quick-add-modal)
3. [Feature 3: Subscription & Selling Plan Sync](#feature-3-subscription--selling-plan-sync)
4. [Feature 4: Dynamic Stitching (Sibling Variants)](#feature-4-dynamic-stitching-sibling-variants)
5. [Feature 5: Upsell Drawer](#feature-5-upsell-drawer)

---

## Feature 1: Smart Sticky Add to Cart

A persistent "Add to Cart" bar that appears at the bottom or top of the screen *only* when the main product form is scrolled out of view.

### 🌊 The Flow
1. The user lands on the Product Detail Page (PDP). The sticky cart is hidden.
2. The user scrolls down. Once the native "Add to Cart" button passes the **top edge** of the viewport, the sticky cart slides into view.
3. If the user scrolls back up and the main button re-enters the viewport, the sticky cart hides.
4. Clicking the sticky button programmatically clicks the hidden main button.

### 🛠 Methodology
* **Web Component:** Encapsulated in `<sticky-add-to-cart>`.
* **Dependencies:** None. Relies purely on standard theme DOM elements.

---

## Feature 2: Quick Add Modal

A fast, AJAX-powered modal that loads a full product detail view directly from a collection or recommendation grid without forcing a page reload.

### 🌊 The Flow
1. The user clicks a **Quick View** button on a product card.
2. A modal (`<dialog>`) opens immediately with a loading state.
3. The component fetches the target product's HTML asynchronously.
4. The fetched HTML is parsed, and *only* the required product component is injected into the modal.
5. Clicks on the modal backdrop close it securely without triggering internal links.

### 🛠 Methodology
* **Web Component:** Encapsulated in `<quick-view>`.
* **Fetch API:** Uses `fetch(product_url)` to grab the product HTML.
* **DOMParser:** Parses the returned HTML string into a queryable DOM object to extract just the `<product-component>`.
* **Script Re-evaluation:** Iterates through injected `<script>` tags, clones them, and re-appends them to the DOM to ensure theme scripts (like variant selection) initialize properly inside the dynamically generated modal.

---

## Feature 3: Subscription & Selling Plan Sync

A robust interceptor logic that ensures third-party subscription app widgets (like Skio, Recharge, or Shopify Subscriptions) function perfectly when loaded dynamically inside a Quick View modal or after a Dynamic Stitch swap.

### 🌊 The Flow
1. A product with subscription options is dynamically loaded into the DOM.
2. The sync method scans the injected HTML for native subscription app blocks (specifically radio buttons and group dropdowns).
3. It dynamically generates or targets a hidden `selling_plan` input inside the main add-to-cart form.
4. When a user toggles between "One-Time Purchase" and "Subscribe", the hidden input instantly updates with the correct `selling_plan` ID.

### 🛠 Methodology
* **Method Integration:** This logic is built directly into the `<quick-view>` and `<dynamic-stitch>` classes (`#initSellingPlanSync`) to run automatically upon DOM injection.
* **Dependencies:** Fully compatible with the standard Shopify Subscriptions app block architecture.

---

## Feature 4: Dynamic Stitching (Sibling Variants)

Separates color variants into entirely separate Shopify products (for better SEO and collection filtering) but visually "stitches" them together on the PDP as if they were standard variant swatches.

### 🌊 The Flow
1. User clicks a color swatch on a product page.
2. Instead of loading a new page, the component fetches the sibling product's URL.
3. It seamlessly replaces the main `<product-component>`, updates the active swatch state, and replaces the `<sticky-add-to-cart>` data.
4. The browser's URL and page title update silently.

### 🛠 Methodology
* **Web Component:** Encapsulated in `<dynamic-stitch>`.
* **History API:** Uses `window.history.pushState()` to update the URL dynamically, and listens to the `popstate` event to handle users clicking the browser's "Back" button.
* **DOM Swap:** Uses the Fetch API to grab the sibling product, replacing the old DOM elements and re-executing scripts (leveraging the exact same re-evaluation logic from the Quick View feature).

### 🗄 Data Structure (Metafields)
To make this work, products must be linked via a shared metafield.
* **Metafield Namespace/Key:** `custom.stitch_group`
* **Type:** Single line text
* **Usage:** Assign the exact same text string (e.g., `Classic-Tee-Group`) to all sibling products. In the Liquid template, loop through products that share this metafield value to render the swatches.

---

## Feature 5: Upsell Drawer

A highly optimized cart drawer implementation featuring a horizontally scrolling recommendation section.

### 🌊 The Flow
1. User adds an item to the cart, automatically opening the Cart Drawer.
2. Below the cart items, a horizontally scrolling row of complementary products appears.
3. The user clicks "Quick Add" on a recommended item, triggering the `<quick-view>` modal to open *over* the drawer.

### 🛠 Methodology
* **Native Reuse:** The upsell buttons directly utilize the `<quick-view>` Web Component built in Feature 2, ensuring zero code duplication and consistent behavior.

### 🗄 Data Structure (Metafields)
Recommendations are driven by cart contents.
* **Metafield Namespace/Key:** `custom.upsell_products`
* **Type:** List of Products
* **Usage:** Displayed dynamically based on the items currently inside the cart. If multiple items are in the cart, the drawer aggregates and deduplicates the recommended products from this metafield.
  > **Note:** If the last item added to the cart has no upsell products defined in its metafield, the code gracefully falls back to fetch the 2nd-to-last product's upsell items.
