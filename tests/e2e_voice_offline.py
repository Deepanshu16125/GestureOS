"""Offline voice end-to-end: page (Engine=Offline) ↔ bridge on :8766 started with
GESTUREOS_VOICE_WAV=air_draw.wav:next_slide.wav --dry-run. Expect mode→draw then next slide."""
import asyncio, json
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(channel='chrome');pg=await b.new_page();errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto('http://localhost:8000/?v=10');await pg.wait_for_timeout(800)
    await pg.evaluate("()=>{GestureOS.setMode('voice');document.getElementById('bridgeUrl').value='ws://localhost:8766';document.getElementById('voiceEngine').value='offline';}")
    s0=await pg.evaluate("GestureOS.slide")
    await pg.click('#voiceBtn')
    levels=[]
    for _ in range(40):
      await pg.wait_for_timeout(250);levels.append(await pg.evaluate("getComputedStyle(document.getElementById('micMeter')).getPropertyValue('--p')"))
      if await pg.evaluate("GestureOS.slide")!=s0:break
    r=await pg.evaluate("()=>({mode:GestureOS.mode,slide:GestureOS.slide,engine:GestureOS.voiceEngine,status:document.getElementById('voiceStatus').textContent,heard:document.getElementById('voiceText').textContent,did:document.getElementById('voiceCmd').textContent,log:[...document.querySelectorAll('#log li')].slice(0,6).map(l=>l.textContent)})")
    r['slide_before']=s0;r['max_level']=max(float(x or 0) for x in levels);r['errors']=errs
    print(json.dumps(r,indent=1));await b.close()
    assert r['slide']!=s0 and r['engine']=='offline' and r['max_level']>0.05 and not errs
asyncio.run(main())
