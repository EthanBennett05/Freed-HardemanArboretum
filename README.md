# Freed-Hardeman Arboretum Map

An interactive web application and specimen ledger for exploring and managing tree data across the Freed-Hardeman University campus. Built with modern vanilla Web technologies, Google Maps Advanced Markers, and Supabase for real-time data storage and authentication.

**Live Application:** [https://freed-hardeman-arboretum.netlify.app](https://freed-hardeman-arboretum.netlify.app)

---

## Key Features

* **Interactive Campus Map:** Custom satellite map interface restricted strictly to FHU campus boundaries with zoom constraints.
* **Specimen Registry Table:** Formatted ledger listing specimens alphabetically by species name alongside unique tag IDs.
* **Real-time Search & Filter:** Filter map markers and the table registry instantly by species name, tag ID, or notes.
* **Google OAuth Authentication:** Admin access powered by Supabase Auth and Google OAuth, displaying user profile avatars directly in the header.
* **Role-Based Access Control (RBAC):** Public users enjoy read-only access. Authenticated admins unlock full editing capabilities.
* **Admin Management Tools:**
  * **Add Trees:** Click directly on the map to drop new tree markers.
  * **Drag-and-Drop Repositioning:** Move markers across the map with automatic database updates.
  * **Specimen Editor:** Edit species details, tag IDs, and notes in real time.
  * **Safety Confirmation Delete:** Two-step arm/confirm mechanism for tree deletion.
* **FHU Brand Identity:** Styled using official Freed-Hardeman Maroon (`#701422`) and Gold (`#c59b27`) design language.

---

## Tech Stack
* **Maps Integration:** [Google Maps JavaScript API](https://developers.google.com/maps) utilizing modern `AdvancedMarkerElement` and `PinElement`.
* **Backend & Auth:** [Supabase](https://supabase.com) (PostgreSQL, Row Level Security, Auth, RPC functions).
* **Hosting & CI/CD:** [Netlify](https://www.netlify.com) continuous deployment with dynamic environment variable injection.

t unauthorized edits.




