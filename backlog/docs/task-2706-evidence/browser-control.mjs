import {chromium} from '/tmp/task2706-browser/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:19276');
const page=browser.contexts()[0].pages().find(p=>p.url().startsWith("http://127.0.0.1:"));
page.setDefaultTimeout(10000);
const location=JSON.parse(fs.readFileSync('backlog/docs/task-2706-evidence/session-location.json'));
await (new Function('page','location','fs',`return (async()=>{${process.argv[2]}})()`))(page,location,fs);
await browser.close();
