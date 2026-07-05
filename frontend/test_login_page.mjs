import { chromium } from 'playwright';

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    console.log(`BROWSER PAGEERROR: ${err.message}`);
  });

  try {
    console.log('Navigating to login page...');
    await page.goto('http://localhost:5173/?login=1');
    
    console.log('Filling form with dummy credentials...');
    await page.fill('#login-email', 'test-nonexistent-user-123@example.com');
    await page.fill('#login-password', 'somepassword');
    
    console.log('Submitting login form...');
    await page.click('button[type="submit"]');
    
    console.log('Waiting for feedback...');
    await page.waitForTimeout(3000);
    
    const feedback = await page.textContent('#login-feedback');
    console.log('Feedback shown on page:', feedback);
  } catch (e) {
    console.error('Test execution failed:', e);
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
})();
