# 🧺 WashFlow — Laundry Management System

> **"Laundry today or naked tomorrow"**

WashFlow is a complete, client-side Laundry Management System built using **HTML5**, **CSS**, and **JavaScript**—the core web technologies covered in my academic syllabus. The application streamlines order intake, garment pricing, drag-and-drop workflow tracking, role-based access control (RBAC), real-time audio/desktop notifications, and customer feedback, running 100% locally in the browser with `localStorage` persistence[cite: 1, 2, 3].

---

## ✨ Key Features

### 🔐 Authentication & Role-Based Access Control (RBAC)
* **Three Distinct Roles:**
  * **Customer (`User`):** Place new laundry pickup orders, track live order progress on a visual step tracker, edit or cancel their own orders, and submit service reviews.
  * **Staff (`Operator`):** View all orders, update order statuses via dropdowns or the Kanban board, and manage daily facility operations.
  * **Manager (`Manager`):** Full administrative control—create, modify, advance, or delete any order across the system.
* **Account Registration & Security Key:** New users can sign up directly from the login screen. Registering as **Staff** or **Manager** requires a protected authorization key (`1627`).
* **Demo Credentials Included:** Instant sign-in support via built-in accounts (`admin@washflow.com` / `staff@washflow.com`, password: `password123`).

### 📊 Operations Dashboard & Order Tracking
* **Live Metrics:** Real-time cards tracking **Total Orders**, **Pending Pickup**, **In Progress**, **Out for Delivery**, and **Completed** orders.
* **Customer Live Tracking Portal:** Logged-in customers see a dedicated 5-stage visual progress bar (*Pickup Requested → At Facility → In Processing → Out for Delivery → Delivered*) for their active orders.
* **Search, Filter & Sort:** Filter orders by workflow status, search by Order ID (`#WF-XXXX`), customer name, or phone number, and sort chronologically or alphabetically.

### 📋 Interactive Kanban Workflow Board
* **Drag-and-Drop Columns:** Move orders seamlessly across 5 workflow stages:
  1. `Pending Pickup`
  2. `At Facility`
  3. `In Processing`
  4. `Out for Delivery`
  5. `Delivered`
* **Grid & List Views:** Switch between a detailed multi-column card grid and a compact list layout in the **All Orders** view[cite: 1, 2].

### 🧮 Dynamic Pricing & Itemized Receipts (INR ₹)
* **Automatic Cost Calculator:** Calculates real-time order totals based on garment presets (Shirts, Pants, Jeans, Kurta, Saree, Bedsheet, Towel, Jacket, Dress, etc.) or custom items.
* **Service Tier Multipliers:**
  * **Wash & Fold:** `1.0x` Base Rate
  * **Dry Cleaning:** `1.8x` Premium Rate
  * **Ironing Only:** `0.6x` Pressing Rate
* **Priority Surcharges:**
  * **Normal:** `₹0` (Standard)
  * **Urgent:** `+₹75`
  * **Express:** `+₹150`
* **Itemized Receipt Modal:** View full line-by-line breakdowns, customer contact details, pickup addresses, and special garment handling instructions[cite: 1, 2].

### 🔔 Real-Time Alerts & Customer Feedback
* **Web Audio API Chimes & Desktop Push Notifications:** Generates custom multi-tone audio chimes and triggers native browser push notifications when new orders are placed, completed, or reviewed.
* **Customer Reviews & Ratings:** Verified customers can rate orders (1–5 stars) across categories (*Wash Quality, Delivery Speed, Ironing & Finish, Packaging, Customer Support*), complete with rating breakdown bars and star filters[cite: 1, 2].

---

## 🛠️ Technologies Used

This project is built purely with **HTML5**, **CSS**, and **JavaScript** (as taught in my course syllabus), without relying on external frontend frameworks[cite: 3]:

* **HTML5:** Semantic structure for the login view, dashboard, Kanban board, order cards, feedback section, and interactive modals[cite: 2].
* **CSS:** Custom stylesheet (`style.css`) using CSS variables, Flexbox, CSS Grid, keyframe animations, and responsive media queries[cite: 3].
* **JavaScript:** Handles application state, role-based permissions, live cost calculations, drag-and-drop workflow updates, audio chimes, and browser `localStorage` data persistence.
* **Icons & Fonts:** [Lucide Icons](https://lucide.dev/) & [Google Fonts (Inter)](https://fonts.google.com/specimen/Inter)[cite: 2]

---

## 📂 Project Structure

```text
washflow-laundry-management/
├── index.html      # Main application layout, views, and modals (Login, Dashboard, Kanban, Orders, Feedback)
├── style.css       # Custom CSS variables, responsive grid/flex layouts, animations, and modal themes
├── app.js          # JavaScript logic for RBAC, pricing, Kanban drag-and-drop, notifications, and localStorage
└── README.md       # Project documentation
