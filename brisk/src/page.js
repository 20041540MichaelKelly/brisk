'use strict';
/*
 * The ui library that Brisk apps use, and the HTML page they are built into.
 * uiRuntime runs in the browser, so it is turned into text and placed in the page.
 */
function uiRuntime(){
  var root=document.getElementById('app');
  var tell=function(t,a){ console.log(t+': '+a); };
  function add(tag,text){ var e=document.createElement(tag); if(text!=null) e.textContent=text; root.appendChild(e); return e; }
  function wrap(e){
    return { el:e,
      set:function(t){ e.textContent=t; return this; },
      hide:function(){ e.style.display='none'; return this; },
      show:function(){ e.style.display=''; return this; },
      color:function(c){ e.style.color=c; return this; },
      remove:function(){ e.remove(); } };
  }
  window.test=function(name,fn){ try{ fn(); tell('pass',name); }catch(e){ tell('fail',name+' \u2014 '+e.message); } };
  return {
    title:function(t){ document.title=t; return wrap(add('h1',t)); },
    text:function(t){ return wrap(add('p',t)); },
    button:function(t,fn){ var e=add('button',t); e.addEventListener('click',function(){ if(fn) fn(); }); return wrap(e); },
    input:function(hint){
      var e=add('input'), w=wrap(e); e.placeholder=hint||'';
      Object.defineProperty(w,'value',{get:function(){ return e.value; },set:function(v){ e.value=v; }});
      return w;
    },
    list:function(items){
      var e=add('ul'), w=wrap(e);
      w.set=function(a){ e.textContent=''; (a||[]).forEach(function(x){ var li=document.createElement('li'); li.textContent=x; e.appendChild(li); }); return w; };
      return w.set(items);
    },
    canvas:function(w,h){
      var e=add('canvas'); e.width=w||300; e.height=h||300; var c=e.getContext('2d');
      return { el:e, ctx:c, width:e.width, height:e.height,
        clear:function(color){ if(color){ c.fillStyle=color; c.fillRect(0,0,e.width,e.height); } else c.clearRect(0,0,e.width,e.height); },
        rect:function(x,y,w2,h2,color){ c.fillStyle=color||'#0b6e75'; c.fillRect(x,y,w2,h2); },
        circle:function(x,y,r,color){ c.fillStyle=color||'#0b6e75'; c.beginPath(); c.arc(x,y,r,0,6.2832); c.fill(); },
        text:function(t,x,y,color,size){ c.fillStyle=color||'#18212b'; c.font=(size||18)+'px system-ui,sans-serif'; c.fillText(t,x,y); },
        onTap:function(fn){ e.addEventListener('pointerdown',function(ev){ var b=e.getBoundingClientRect(); fn((ev.clientX-b.left)*e.width/b.width,(ev.clientY-b.top)*e.height/b.height); }); } };
    },
    every:function(ms,fn){ return setInterval(fn,ms); },
    after:function(ms,fn){ return setTimeout(fn,ms); },
    stop:function(id){ clearInterval(id); clearTimeout(id); },
    clear:function(){ root.textContent=''; },
    background:function(c){ document.body.style.background=c; }
  };
}

const CSS = ':root{color-scheme:light dark}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:20px 16px;line-height:1.45;background:Canvas;color:CanvasText}main{max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:12px}h1{font-size:24px;margin:0 0 4px}p{margin:0}button{font:inherit;font-weight:600;padding:12px 16px;border:0;border-radius:10px;background:#0b6e75;color:#fff}button:active{opacity:.8}input{font:inherit;font-size:16px;padding:11px 12px;border:1px solid #8a97a5;border-radius:10px;background:Field;color:FieldText}ul{margin:0;padding-left:20px}canvas{max-width:100%;border:1px solid #8a97a5;border-radius:10px;touch-action:none}';

/* Wrap compiled Brisk code in a complete, self-contained web page. */
function page(code, title) {
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + (title || 'Brisk app') + '</title>\n<style>' + CSS + '</style>\n</head>\n<body>\n<main id="app"></main>\n<script>var ui=(' + uiRuntime.toString() + ')();</' + 'script>\n<script>\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</' + 'script>\n</body>\n</html>\n';
}

const usesUi = (source) => /\bui\s*\./.test(source);

module.exports = { page, usesUi };
