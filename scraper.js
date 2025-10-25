import dotenv from "dotenv";
dotenv.config();

import puppeteer from "puppeteer"; // <-- Use puppeteer, not puppeteer-core

const isRender = !!process.env.RENDER;

// Launch Puppeteer browser
import fs from "fs";

async function launchBrowser() {
  const isRender = !!process.env.RENDER;

  const options = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };

  // Use Render's system Chromium if available
  const renderChromium = "/usr/bin/chromium-browser";
  if (isRender && fs.existsSync(renderChromium)) {
    options.executablePath = renderChromium;
    console.log("Using Render system Chromium:", renderChromium);
  } else {
    console.log("Using Puppeteer's bundled Chromium.");
  }

  return await puppeteer.launch(options);
}

// Delay helper
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Try to open a page safely with retries
async function safeGoto(page, url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
      return;
    } catch (err) {
      if (i === retries) throw err;
      await delay(3000);
    }
  }
}

// Extract phone numbers from text
function extractPhones(text) {
  const matches = text.match(/(?:\+?\d[\d\s().\-–—]{7,}\d)/g);
  if (!matches) return [];
  return [
    ...new Set(
      matches
        .map((n) => n.replace(/[^\d+]/g, ""))
        .filter((n) => n.length >= 8 && n.length <= 15)
    ),
  ];
}

// Click all "see more" or similar buttons
async function expandAllSeeMore(page) {
  await page.evaluate(() => {
    const patterns = [
      "see more",
      "show more",
      "read more",
      "load more",
      "show full post",
      "see translation",
      "और देखें",
    ];

    document
      .querySelectorAll('div[role="button"], span[role="button"]')
      .forEach((btn) => {
        const txt = btn.innerText?.toLowerCase() || "";
        const aria = btn.getAttribute("aria-label")?.toLowerCase() || "";
        if (patterns.some((p) => txt.includes(p) || aria.includes(p))) {
          try {
            btn.click();
          } catch {}
        }
      });
  });
}

// Check if the session is still logged in
async function verifyLogin(page) {
  const url = page.url();
  if (
    url.includes("login") ||
    (await page.$("input[name='email']")) ||
    (await page.$("button[name='login']")) ||
    url.includes("checkpoint")
  ) {
    throw new Error("COOKIES_EXPIRED");
  }
}

// Main scraper function
export async function scrapeFacebookGroup(
  GROUP_URL,
  SCROLL_LIMIT = 40,
  progressCallback = () => {},
  COOKIES = []
) {
  const log = (msg) => {
    console.log(msg);
    progressCallback({ type: "log", msg });
  };

  const progress = (i, total, foundPosts, foundNumbers) =>
    progressCallback({ type: "progress", i, total, foundPosts, foundNumbers });

  log("Launching Puppeteer...");
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Apply cookies if provided
    if (COOKIES.length) {
      log(`Applying ${COOKIES.length} cookies...`);

      await page.goto("https://www.facebook.com", {
        waitUntil: "domcontentloaded",
      });
      const context = page.browserContext();

      for (const c of COOKIES) {
        delete c.sameSite;
        try {
          await context.setCookie(c);
        } catch (err) {
          console.warn("Failed to set cookie:", err.message);
        }
      }
      log("Cookies applied successfully.");
    }

    log(`Opening group: ${GROUP_URL}`);
    await safeGoto(page, GROUP_URL);
    await delay(3000);
    await verifyLogin(page);

    const results = [];
    const seenPosts = new Set();
    const seenPhones = new Set();
    let totalPhones = 0;

    log(`Scrolling ${SCROLL_LIMIT} times...`);
    for (let i = 1; i <= SCROLL_LIMIT; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await delay(2500);
      await expandAllSeeMore(page);
      await delay(1500);

      const posts = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll(
            'div[role="article"], div[data-ad-preview="message"]'
          )
        );
        return nodes.map((node) => {
          const text = node.innerText || "";

          let user = "";
          const selectors = [
            'h3 a[role="link"] span',
            "strong a",
            'a[role="link"] strong span',
            'a[aria-hidden="false"] span[dir="auto"]',
            'div[dir="auto"] strong span',
            'span[class*="x1hl2dhg"]',
            'span[class*="xdj266r"]',
            'span[dir="auto"] strong',
            'a[role="link"] > span[dir="auto"]',
          ];
          for (const sel of selectors) {
            const el = node.querySelector(sel);
            if (
              el &&
              el.innerText &&
              el.innerText.trim().length > 2 &&
              el.innerText.length < 50
            ) {
              user = el.innerText.trim();
              break;
            }
          }

          if (!user) {
            const txt = node.innerText || "";
            const line = txt
              .split("\n")
              .find((l) => /\b(h|d|m|·)\b/i.test(l) && l.length < 80);
            if (line) {
              const parts = line.split("·");
              if (parts[0] && parts[0].trim().length > 2)
                user = parts[0].trim();
            }
          }

          user =
            user.replace(/\s*\(admin\)|Group|Page/gi, "").trim() || "Unknown";

          return { id: text.slice(0, 200), user, text };
        });
      });

      for (const post of posts) {
        if (seenPosts.has(post.id)) continue;
        seenPosts.add(post.id);

        const phones = extractPhones(post.text);
        if (!phones.length) continue;

        const cleanUser =
          post.user.replace(/\s*\(admin\)|Group|Page/gi, "").trim() ||
          "Unknown";
        const newPhones = phones.filter((p) => !seenPhones.has(p));
        newPhones.forEach((p) => seenPhones.add(p));
        if (!newPhones.length) continue;

        totalPhones += newPhones.length;
        results.push({ postUser: cleanUser, postPhones: newPhones.join(", ") });
      }

      progress(i, SCROLL_LIMIT, results.length, totalPhones);
      log(
        `Scroll ${i}/${SCROLL_LIMIT} — ${results.length} posts, ${totalPhones} total numbers.`
      );

      if (totalPhones >= 800) {
        log("Enough numbers found, stopping early.");
        break;
      }
    }

    const csv =
      "postUser,postPhones\n" +
      results
        .map(
          (r) =>
            `"${r.postUser.replace(/"/g, '""')}","${r.postPhones.replace(
              /"/g,
              '""'
            )}"`
        )
        .join("\n");

    const fileName = `facebook_group_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.csv`;

    log(
      `Finished: ${results.length} unique posts, ${totalPhones} phone numbers.`
    );
    log("CSV created in memory (not saved to disk).");

    return { csv, fileName };
  } catch (err) {
    if (err.message === "COOKIES_EXPIRED") {
      log("Cookies expired — please update them from a logged-in session.");
    } else {
      log(`Scraper crashed: ${err.message}`);
    }
    throw err;
  } finally {
    await browser.close();
    log("Browser closed.");
  }
}

// Handle shutdown cleanly
process.on("SIGTERM", () => {
  console.log("Shutting down gracefully...");
  process.exit(0);
});
