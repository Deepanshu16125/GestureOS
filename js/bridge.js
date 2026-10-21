// WebSocket client for the GestureOS Python bridge (protocol v1, see bridge/PROTOCOL.md).
export class BridgeClient{
  constructor(){this.ws=null;this.ready=false;this.killed=false;this.screen=null;this.dryRun=false;
    this.rtt=null;this.pingId=0;this.pending=new Map();this.lastMove=0;this.on={};}
  emit(ev,d){(this.on[ev]||[]).forEach(f=>f(d));}
  addListener(ev,f){(this.on[ev]=this.on[ev]||[]).push(f);}
  get connected(){return this.ws&&this.ws.readyState===1;}
  connect(url='ws://localhost:8765'){
    this.disconnect(true);this.emit('status','connecting');
    let ws;try{ws=new WebSocket(url);}catch(e){this.emit('status','error');this.emit('log','Bridge: '+e.message);return;}
    this.ws=ws;
    ws.onopen=()=>this.raw({type:'hello',app:'gestureos',version:1});
    ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}this.handle(m);};
    ws.onerror=()=>this.emit('log','Bridge: connection error (is `python -m bridge` running?)');
    ws.onclose=()=>{const was=this.ready;this.ready=false;clearInterval(this.pingTimer);if(this.ws===ws){this.ws=null;this.emit('status','disconnected');if(was)this.emit('log','Bridge disconnected');}};
  }
  disconnect(silent){if(!this.ws)return;try{if(this.ready)this.raw({type:'bye'});}catch{}const ws=this.ws;this.ws=null;this.ready=false;clearInterval(this.pingTimer);ws.close();if(!silent)this.emit('status','disconnected');}
  handle(m){
    switch(m.type){
      case 'ack':this.ready=true;this.killed=!!m.killed;this.screen=m.screen;this.dryRun=!!m.dryRun;this.backend=m.backend||(m.dryRun?'dry-run':'pyautogui');this.watchdog=m.watchdog;
        this.emit('status',this.killed?'killed':'connected');
        this.emit('log',`Bridge ready: ${this.backend}, screen ${m.screen?.w}×${m.screen?.h}${this.watchdog?`, watchdog ${this.watchdog}s`:''}`);
        this.emit('ack',m);
        // v1.1: server starts paused and has an idle watchdog, so ping every 500 ms.
        this.pingTimer=setInterval(()=>this.ping(),500);this.ping();break;
      case 'state':this.killed=!!m.killed;this.emit('state',{killed:this.killed,reason:m.reason||(this.killed?'kill':'resume')});this.emit('status',this.killed?'killed':'connected');break;
      case 'pong':{const t=this.pending.get(m.id);if(t!==undefined){this.rtt=performance.now()-t;this.pending.delete(m.id);this.emit('rtt',this.rtt);}break;}
      case 'error':
        if(m.code==='failsafe'){this.killed=true;this.emit('state',{killed:true,reason:'failsafe'});this.emit('status','killed');}
        if(m.code!=='rate_limited'&&m.code!=='killed')this.emit('log',`Bridge error ${m.code}: ${m.message||''}`);break;
    }
  }
  raw(m){if(this.connected)this.ws.send(JSON.stringify(m));}
  send(m){if(this.ready&&!this.killed)this.raw(m);}
  // mouseUp always goes out (bridge also releases on kill/disconnect).
  ping(){const id=++this.pingId;this.pending.set(id,performance.now());if(this.pending.size>10)this.pending.delete(this.pending.keys().next().value);this.raw({type:'ping',id});}
  /** Throttled to ~60 Hz. x,y in 0..1 (already mirrored by caller). */
  move(x,y,force=false){const n=performance.now();if(!force&&n-this.lastMove<16)return;this.lastMove=n;
    this.send({type:'move',x:+Math.min(1,Math.max(0,x)).toFixed(4),y:+Math.min(1,Math.max(0,y)).toFixed(4)});}
  click(button='left'){this.send({type:'click',button});}
  mouseDown(button='left'){this.send({type:'mouseDown',button});}
  mouseUp(button='left'){this.raw({type:'mouseUp',button});}
  scroll(dy,dx=0){this.send({type:'scroll',dx:Math.max(-50,Math.min(50,dx|0)),dy:Math.max(-50,Math.min(50,dy|0))});}
  kill(){this.killed=true;this.raw({type:'mouseUp',button:'left'});this.raw({type:'kill'});} // local gate closes at once
  resume(){this.raw({type:'resume'});}
}
