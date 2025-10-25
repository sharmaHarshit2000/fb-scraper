# Facebook Group Scraper

A powerful Node.js + Puppeteer web app that extracts **phone numbers** from **Facebook group posts** (public or private) using your authenticated Facebook cookies.

---

## Features
- Extracts all visible **phone numbers** from group posts  
- Works with **public or private** Facebook groups (using cookies)  
- Saves results as a downloadable **CSV file**  
- Lightweight web frontend  
- Built using **Express**, **Puppeteer**, and **JavaScript-ready** backend  

---

## Live Demo Screenshot

![App Screenshot](https://github.com/FluxMessenger/facebook-group-scraper/blob/main/assets/screenshot.png?raw=true)

---

## Installation

```bash
# Clone the repository
git clone https://github.com/FluxMessenger/facebook-group-scraper.git

# Navigate to project folder
cd facebook-group-scraper

# Install dependencies
npm install
```

---

## Usage

### Start Backend
```bash
npm start
```
This launches the Express server with Puppeteer backend at:  
**http://localhost:3000**

### Start Frontend (local view)
Open the `index.html` file in your browser using Live Server  
or place it inside `/public` folder of the backend.

By default, the frontend will detect:
- `localhost:3000` when running locally (`5500` port)
- otherwise, it will use the same origin (useful for deployment)

---

## How to Get Facebook Cookies

###  Step 1 — Install Cookie Editor Extension  
[https://cookie-editor.com/](https://cookie-editor.com/)

Available for Chrome / Firefox / Edge.

---

### Step 2 — Export Cookies
1. Open **Facebook** and log in.  
2. Click on the **Cookie Editor extension icon**.  
3. Click **“Export”** → choose **“Export as JSON”**.  
4. Copy the entire JSON text.

Example:
```json
[
  {"domain":".facebook.com","hostOnly":false,"httpOnly":false,"name":"c_user","path":"/","secure":true,"value":"123456789"},
  {"domain":".facebook.com","hostOnly":false,"httpOnly":true,"name":"xs","path":"/","secure":true,"value":"abc:xyz"}
]
```

5. Paste it inside the **Cookies** field in the web app.  
6. Your cookies are stored **locally (encrypted)** for reuse.

---

## How It Works
1. Puppeteer launches a headless browser.  
2. Applies your Facebook cookies for an authenticated session.  
3. Opens the target group page and auto-scrolls through posts.  
4. Expands all “See more” sections.  
5. Extracts all valid phone numbers from post text.  
6. Generates a downloadable CSV with:
   - Post author name
   - Extracted phone numbers

---

## Output Example

| postUser     | postPhones       |
|---------------|------------------|
| Aman Tiwari   | +919876543210    |
| Vijay Sahu    | 9876543210, 9001234567 |

Output file example:  
`facebook_group_2025-10-19T12-40-01.csv`

---

## Scripts

| Command | Description |
|----------|--------------|
| `npm start` | Run the scraper normally |
| `npm run dev` | Run with `nodemon` (auto-restart) |
| `npm install` | Install dependencies |

---

## Tech Stack
- Node.js
- Express.js
- Puppeteer
- HTML / CSS / JS (Frontend)


---

## Cookie Example Screenshot

![Cookie Editor Screenshot](https://github.com/FluxMessenger/facebook-group-scraper/blob/main/assets/cookie-editor.png?raw=true)



---

## Notes
- Always use **valid, fresh Facebook cookies**.  
- Cookies expire after a few days. Paste new ones if scraping stops.  

---

