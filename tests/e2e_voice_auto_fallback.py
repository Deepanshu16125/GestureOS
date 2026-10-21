import asyncio,json
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(channel='chrome',args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']);pg=await b.new_page()
    await pg.goto('http://localhost:8000/?v=10');await pg.wait_for_timeout(800)
    await pg.evaluate("()=>{GestureOS.setMode('voice');document.getElementById('bridgeUrl').value='ws://localhost:8766';}")
    await pg.click('#voiceBtn');lv=[];st=[]
    for _ in range(60):
      await pg.wait_for_timeout(250);lv.append(await pg.evaluate("[getComputedStyle(micMeter).getPropertyValue('--p'),micSrc.textContent]"));st.append(await pg.evaluate("voiceStatus.textContent"))
      if await pg.evaluate("GestureOS.slide")==1:break
    print(json.dumps({'slide':await pg.evaluate("GestureOS.slide"),'engine':await pg.evaluate("GestureOS.voiceEngine"),'mic':await pg.evaluate("micName.textContent"),'levels':lv[:4],'status_seq':list(dict.fromkeys(st))},indent=1));await b.close()
asyncio.run(main())
