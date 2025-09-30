'use strict';

const { Browser, Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const CDP = require('chrome-remote-interface');

const { setTimeout } = require('timers/promises');
const fs = require('fs/promises');

const apptSysId = process.argv[2];
const roomName = process.argv[3];

async function buildChromeDriver() {
  const options = new chrome.Options()
    .addArguments('--headless=new')
    .addArguments('--disable-extensions')
    .addArguments('--remote-debugging-port=9222');
  return new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();
}

(async () => {
  const driver = await buildChromeDriver();

  const client = await CDP({ port: 9222 });
  const { Network, Page } = client;

  await Network.enable();
  await Page.enable();

  Network.requestWillBeSent(async params => {
    const url = new URL(params.request.url);
    if (params.type === 'XHR' && params.request.method === 'POST' && url.pathname.startsWith('/api')) {
      const headers = params.request.headers;
      const body = JSON.parse(params.request.postData);

      const { cookies } = await Network.getCookies();
      const cookie = cookies
        .filter(cookie => cookie.domain === url.host)
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join(';');
      headers.cookie = cookie;

      const startDate = new Date(body.input_date);
      startDate.setDate(1);

      let allSlots = {};
      for (let i = 0; i < 4; ++i) {
        const inputDate = new Date(startDate);
        inputDate.setMonth(inputDate.getMonth() + i);
        body.input_date = inputDate.toLocaleDateString('sv-SE');

        const response = await fetch(url.href, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
        });

        const json = await response.json();
        const slots = json.result.data.slots;
        allSlots = Object.assign(allSlots, slots);
      }

      const output = {
        slots: allSlots,
        lastUpdate: new Date().toISOString(),
      };
      await fs.writeFile(`docs/${apptSysId}.json`, JSON.stringify(output));
    }
  });

  const url = `https://fujisawacity.service-now.com/facilities_reservation?id=fr_slot_check&appt_sys_id=${apptSysId}`;
  await driver.get(url);
  const name = await driver.findElement(By.css('.room-name .ng-binding')).getText();
  if (name !== decodeURIComponent(roomName))
    console.warn('names do not match...', name, roomName);
  await setTimeout(8 * 1000);

  await driver.quit();
})();

