# End-to-end check: serve on :8000, run 'python -m bridge --dry-run', then run this (needs playwright + Chrome).
# Replays synthetic landmarks through window.GestureOS.feed and prints what each mode did.
import asyncio,json
from playwright.async_api import async_playwright
JS_HELP="""
window.H=await import('/tests/hands.mjs');
window.at=(pose,tx,ty)=>{const h=H.make(H.POSES[pose]);const dx=tx-h[8].x,dy=ty-h[8].y;return h.map(p=>({x:p.x+dx,y:p.y+dy,z:0}));};
// screen point (0..1 of viewport) -> landmark coords for the index tip (inverse of mapInner, mirrored)
window.tipFor=(sx,sy)=>[1-(sx*0.7+0.15),sy*0.7+0.15];
window.run=(pose,n,sx,sy)=>{const [x,y]=tipFor(sx,sy);let g;for(let i=0;i<n;i++)g=GestureOS.feed([at(pose,x,y)]);return g;};
window.sleep=ms=>new Promise(r=>setTimeout(r,ms));
"""
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(channel='chrome')
    pg=await b.new_page(viewport={'width':1366,'height':768})
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto('http://localhost:8000/',wait_until='networkidle')
    await pg.evaluate("async()=>{"+JS_HELP+"}")
    R={}
    # gesture labels through the full pipeline
    R['labels']=await pg.evaluate("()=>Object.fromEntries(['open_palm','fist','point','pinch'].map(k=>[k,run(k,8,.5,.5)]))")
    # Air Mouse: steer onto target A, pinch, release
    R['airmouse']=await pg.evaluate("""async()=>{GestureOS.setMode('cursor');document.getElementById('pad').scrollIntoView({block:'center'});await sleep(100);
      const r=document.querySelector('.target').getBoundingClientRect(),sx=(r.left+r.width/2)/innerWidth,sy=(r.top+r.height/2)/innerHeight;
      for(let i=0;i<80;i++){run('point',1,sx,sy);await sleep(16);} for(let i=0;i<6;i++){run('pinch',1,sx,sy);await sleep(20);} for(let i=0;i<6;i++){run('point',1,sx,sy);await sleep(20);}
      return {clicks:GestureOS.clicks,count:document.getElementById('clickCount').textContent,log:[...document.querySelectorAll('#log li')].slice(0,5).map(l=>l.textContent)};}""")
    # Air Draw: pinch-drag draws, palm stops, clear works
    R['airdraw']=await pg.evaluate("""async()=>{GestureOS.setMode('draw');for(let i=0;i<30;i++){run('pinch',1,.3+i*.01,.5);await sleep(5);}const drawn=GestureOS.drawnPixels();
      run('open_palm',8,.6,.5);document.getElementById('clearDraw').click();return {drawn,afterClear:GestureOS.drawnPixels()};}""")
    # Slides: point at right edge 0.6 s, then button prev
    R['slides']=await pg.evaluate("""async()=>{GestureOS.setMode('slides');const s0=GestureOS.slide;const [x,y]=[0.1,0.5];
      for(let i=0;i<40;i++){GestureOS.feed([at('point',x,y)]);await sleep(20);} const s1=GestureOS.slide; document.getElementById('slidePrev').click();
      return {start:s0,afterPointRight:s1,afterPrevBtn:GestureOS.slide,text:document.getElementById('slide').textContent};}""")
    R['draw_thumbs_clear']=await pg.evaluate("""async()=>{GestureOS.setMode('draw');for(let i=0;i<20;i++){run('pinch',1,.3+i*.01,.5);await sleep(5);}const before=GestureOS.drawnPixels();
      for(let i=0;i<60;i++){GestureOS.feed([H.make(H.POSES.thumbs_up)]);await sleep(16);}return {before,after:GestureOS.drawnPixels()};}""")
    R['slides_swipe']=await pg.evaluate("""async()=>{GestureOS.setMode('slides');await sleep(1000);const s0=GestureOS.slide;
      for(let i=0;i<14;i++){GestureOS.feed([H.make(H.POSES.open_palm,{cx:0.75-i*0.03})]);await sleep(20);}return {before:s0,after:GestureOS.slide};}""")
    R['sign']=await pg.evaluate("""async()=>{GestureOS.setMode('sign');for(const L of ['V','L','Y']){for(let i=0;i<70;i++){GestureOS.feed([H.make(H.LETTER_POSES[L])]);await sleep(16);}GestureOS.feed([]);await sleep(50);}
      return {typed:GestureOS.typed,closest:document.getElementById('signClosest').textContent};}""")
    R['voice']=await pg.evaluate("()=>{GestureOS.setMode('voice');const a=GestureOS.voice('next slide please');const b=GestureOS.voice('draw');return {a,b,mode:GestureOS.mode,btn:!!document.getElementById('voiceBtn').onclick};}")
    # OS control: lever in Air Mouse mode connects, resumes, then moves + clicks
    await pg.evaluate("()=>GestureOS.setMode('cursor')")
    await pg.click('.lever'); await pg.wait_for_timeout(1500)
    R['bridge_after_lever']=await pg.evaluate("()=>({state:document.getElementById('bridgeState').textContent,backend:document.getElementById('hudBackend').textContent,armed:document.body.classList.contains('armed'),lever:document.getElementById('osEnable').checked})")
    R['os']=await pg.evaluate("""async()=>{for(let i=0;i<30;i++){run('point',1,.2+i*.01,.4);await sleep(16);} for(let i=0;i<6;i++){run('pinch',1,.5,.4);await sleep(20);} for(let i=0;i<6;i++){run('point',1,.5,.4);await sleep(20);} return document.getElementById('osAction').textContent;}""")
    await pg.wait_for_timeout(2200)  # no frames -> watchdog? pings continue, so stays connected
    await pg.click('.lever'); await pg.wait_for_timeout(500)
    R['after_lever_off']=await pg.evaluate("()=>document.getElementById('bridgeState').textContent")
    R['credits']=await pg.evaluate("()=>document.querySelector('.foot').textContent")
    R['errors']=errs
    await pg.screenshot(path='e2e-final.png')
    print(json.dumps(R,indent=1))
    await b.close()
asyncio.run(main())
