const path = require('path');
const puppeteer = require(path.resolve(__dirname, '../counsellor-web/node_modules/puppeteer'));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/snap/bin/brave',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // 1. Dashboard Overview
    let page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 2 });
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 15000 });
    await page.screenshot({ path: 'docs/images/02_counsellor_dashboard_overview.png' });

    // 2. Focused District Geographic Hotspot Map (Surveillance section)
    await page.screenshot({
      path: 'docs/images/01_district_geographic_hotspot_map.png',
      clip: { x: 740, y: 440, width: 660, height: 490 }
    });
    await page.close();

    // 3. Alerts Queue
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto('http://localhost:5173/alerts', { waitUntil: 'networkidle0', timeout: 15000 });
    await page.screenshot({ path: 'docs/images/04_clinical_alerts_queue.png' });
    await page.close();

    // 4. Follow-ups
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto('http://localhost:5173/follow-ups', { waitUntil: 'networkidle0', timeout: 15000 });
    await page.screenshot({ path: 'docs/images/05_followup_scheduler.png' });
    await page.close();

    // 5. Cases Directory
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto('http://localhost:5173/cases', { waitUntil: 'networkidle0', timeout: 15000 });
    await page.screenshot({ path: 'docs/images/06_cases_directory.png' });
    await page.close();

    console.log('All web screenshots captured successfully!');
  } catch (err) {
    console.error('Screenshot error:', err);
  } finally {
    await browser.close();
  }
})();
