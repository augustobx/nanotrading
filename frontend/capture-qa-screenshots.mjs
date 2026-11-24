import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const SCREENSHOTS_DIR = 'C:\\Users\\abasq\\.gemini\\antigravity\\brain\\efef72aa-1764-43d0-9cc9-2c1dd615cd98\\screenshots';
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('Launching Chrome from:', CHROME_PATH);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  });

  try {
    const page = await browser.newPage();
    console.log('Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 5000));

    const safeClick = async (text, waitMs = 1500) => {
      await page.evaluate((t) => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find((b) => b.textContent && b.textContent.includes(t));
        if (btn) btn.click();
      }, text);
      await new Promise((r) => setTimeout(r, waitMs));
    };

    // 1. Desktop - Terminal Operativo
    console.log('Capturing 01-desktop-terminal.png...');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-desktop-terminal.png'), fullPage: false });

    // 2. Click "Escenarios IA" in main navigation
    console.log('Clicking Escenarios IA tab...');
    await safeClick('Escenarios IA', 2000);

    // 3. Desktop - Escenarios: En Proceso Ahora
    console.log('Capturing 02-desktop-scenarios-now.png...');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-desktop-scenarios-now.png'), fullPage: false });

    // 4. Click "Señales Aprobadas"
    console.log('Clicking Señales Aprobadas sub-tab...');
    await safeClick('Señales Aprobadas');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-desktop-approved-signals.png'), fullPage: false });

    // 5. Click "Paper Trading"
    console.log('Clicking Paper Trading sub-tab...');
    await safeClick('Paper Trading');
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-desktop-paper-trading.png'), fullPage: false });

    // 6. Click "Finalizados Sin Trade"
    console.log('Clicking Finalizados Sin Trade sub-tab...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent && b.textContent.includes('Finalizados Sin Trade'));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-desktop-discarded-without-trade.png'), fullPage: false });

    // 7. Click "Historial Completo"
    console.log('Clicking Historial Completo sub-tab...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent && b.textContent.includes('Historial Completo'));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06-desktop-full-audit-table.png'), fullPage: false });

    // 8. Click "Embudo / Pipeline"
    console.log('Clicking Embudo / Pipeline sub-tab...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.textContent && b.textContent.includes('Embudo / Pipeline'));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07-desktop-funnel-pipeline.png'), fullPage: false });

    // 9. Open "Ver Detalle" drawer on any scenario
    console.log('Opening Scenario Detail Drawer...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const histBtn = btns.find((b) => b.textContent && b.textContent.includes('Historial Completo'));
      if (histBtn) histBtn.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const detailBtn = btns.find((b) => b.textContent && b.textContent.includes('Ver Detalle'));
      if (detailBtn) detailBtn.click();
    });
    await new Promise((r) => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08-desktop-scenario-detail-drawer.png'), fullPage: false });

    // Close detail drawer
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[title="Cerrar detalle"]');
      if (closeBtn) closeBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    // 10. Mobile Viewport (iPhone 14 / standard mobile 390x844)
    console.log('Switching to mobile viewport 390x844...');
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 3000));
    
    // For 09-mobile-terminal.png: Scroll to "Ahora mismo" executive block below ticker
    console.log('Scrolling to Ahora Mismo block for 09-mobile-terminal.png...');
    await page.evaluate(() => {
      const el = document.getElementById('ahora-mismo-terminal');
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
      } else {
        window.scrollTo(0, 1100);
      }
    });
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09-mobile-terminal.png'), fullPage: false });

    // Mobile - Escenarios IA
    console.log('Clicking Escenarios IA on mobile...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const scBtn = btns.find((b) => b.textContent && b.textContent.includes('Escenarios IA'));
      if (scBtn) {
        scBtn.click();
        scBtn.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    });
    await new Promise((r) => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10-mobile-scenarios.png'), fullPage: false });

    console.log('All QA screenshots captured successfully!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Error running QA screenshot script:', err);
  process.exit(1);
});
