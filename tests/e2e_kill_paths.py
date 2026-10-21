# Kill-path / stuck-mouse check. Serve on :8000, run `python -m bridge --dry-run > bridge.log 2>&1`,
# then: python tests/e2e_kill_paths.py bridge.log   (needs playwright + Chrome)
import asyncio,sys,json
from playwright.async_api import async_playwright
LOG=sys.argv[1] if len(sys.argv)>1 else 'bridge.log'
HELP="""window.H=await import('/tests/hands.mjs');
window.at=(pose,x,y)=>{const h=H.hand(H.POSES[pose]);const dx=x-h[8].x,dy=y-h[8].y;return h.map(p=>({x:p.x+dx,y:p.y+dy,z:0}));};
window.sleep=ms=>new Promise(r=>setTimeout(r,ms));
window.frames=async(pose,n,x=.5,y=.5)=>{for(let i=0;i<n;i++){GestureOS.feed([at(pose,x+i*.002,y)]);await sleep(16);}};"""
def lines(): return open(LOG).read().splitlines()
def inputs(ls): return [l for l in ls if any(k in l for k in ('dry-run move','dry-run mouseDown','dry-run click'))]
async def arm(pg):
    await pg.evaluate("()=>GestureOS.setMode('cursor')")
    if not await pg.evaluate("()=>GestureOS.lever"): await pg.click('.lever')
    await pg.wait_for_timeout(700)
    await pg.evaluate("()=>frames('point',20)")
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(channel='chrome')
    pg=await b.new_page(viewport={'width':1366,'height':768})
    await pg.goto('http://localhost:8000/',wait_until='networkidle'); await pg.evaluate("async()=>{"+HELP+"}")
    paths={
     'KILL button': "()=>document.getElementById('killBtn').click()",
     'Esc key': None,
     'fist 1 s': "()=>frames('fist',80)",
     'hand lost': "()=>GestureOS.feed([])",
     'mode change mid-pinch': "async()=>{await frames('pinch',4);document.querySelector('#tabs [data-mode=draw]').click();}",
    }
    out={}
    for name,js in paths.items():
        await arm(pg); before=len(lines()); armed=await pg.evaluate("()=>GestureOS.armed")
        if js: await pg.evaluate(js)
        else: await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(300); mark=len(lines())
        # keep feeding input after the kill: none of it may reach the bridge
        await pg.evaluate("async()=>{await frames('point',20);await frames('pinch',5);await frames('point',10);}")
        await pg.wait_for_timeout(400)
        L=lines()
        out[name]={'armed_before':armed,'moves_before_kill':len(inputs(L[:before])) >0,
          'kill_logged':any(('Kill switch ON' in l) for l in L[before:mark]),
          'released':[l.split(' INFO ')[-1] for l in L[before:mark] if 'mouseUp' in l or 'releaseAll' in l],
          'input_after_kill':len(inputs(L[mark:])),
          'lever':await pg.evaluate("()=>GestureOS.lever"),'armed_after':await pg.evaluate("()=>GestureOS.armed"),
          'state':await pg.evaluate("()=>document.getElementById('bridgeState').textContent")}
        await pg.wait_for_timeout(300)
    print(json.dumps(out,indent=1)); await b.close()
    sys.exit(0 if all(v['kill_logged'] and v['input_after_kill']==0 and not v['lever'] for v in out.values()) else 1)
asyncio.run(main())
