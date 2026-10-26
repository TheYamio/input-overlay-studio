// General regressions start after onboarding. The dedicated setup suite uses
// Playwright directly and tests untouched, skipped and resumed installations.
import {chromium as playwrightChromium} from '@playwright/test';
export {expect} from '@playwright/test';
export const chromium={
 async launch(options){
  const browser=await playwrightChromium.launch(options),newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
   const context=await newContext(options);
   await context.addInitScript(()=>{if(localStorage.getItem('studio.setup')===null)localStorage.setItem('studio.setup',JSON.stringify({version:1,status:'skipped',step:0}));});
   return context;
  };
  return browser;
 },
};
