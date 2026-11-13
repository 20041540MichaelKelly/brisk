'use strict';
/*
 * Brisk compiler: one pass over the source, straight to JavaScript.
 * Every Brisk line becomes exactly one JavaScript line, so error line numbers match.
 * Usage: const { compile } = require('./compiler'); compile(source) -> { code, errors, lines }
 */
var B_P=0, B_ERR='', B_DEPTH=0;
function isWord(k){ return (k>=97&&k<=122)||(k>=65&&k<=90)||(k>=48&&k<=57)||k===95||k===36; }
/* "text {expr}" -> `text ${expr}`. s[i] is the opening quote, n is the end of the line. Sets B_P after the closing quote. */
function str(s,i,n){
  var o='`', from=++i, c, d, j, depth;
  while(i<n){
    c=s.charCodeAt(i);
    if(c===34){ B_P=i+1; return o+s.slice(from,i)+'`'; }
    if(c===92){
      d=s.charCodeAt(i+1);
      if(d===123||d===125){ o+=s.slice(from,i)+s.charAt(i+1); i+=2; from=i; } else i+=2;
      continue;
    }
    if(c===96||c===36){ o+=s.slice(from,i)+'\\'+s.charAt(i); i++; from=i; continue; }
    if(c===123){
      depth=1; j=i+1;
      while(j<n&&depth){ d=s.charCodeAt(j); if(d===123) depth++; else if(d===125) depth--; j++; }
      if(depth){ B_ERR='This string has a { without a matching }'; B_P=n; return o+'`'; }
      o+=s.slice(from,i)+'${'+expr(s,i+1,j-1)+'}'; i=j; from=i; continue;
    }
    i++;
  }
  B_ERR='This string is missing its closing quote'; B_P=n; return o+s.slice(from,n)+'`';
}
/* Translate s[i..n) in place, with no intermediate line copies: and/or/not/is/isnt/nil, == and !=, strings.
   Stops at a # comment and trims both ends. */
function expr(s,i,n){
  var o='', c, j, k, w, r, from;
  while(i<n&&((c=s.charCodeAt(i))===32||c===9)) i++;
  from=i;
  while(i<n){
    c=s.charCodeAt(i);
    if(c===32){ i++; continue; }
    if((c>=97&&c<=122)||(c>=65&&c<=90)||c===95||c===36){
      j=i+1; while(j<n&&isWord(s.charCodeAt(j))) j++;
      k=j-i;
      if(k<5&&k>1&&(c===97||c===111||c===110||c===105)){
        w=s.slice(i,j);
        r=w==='and'?'&&':w==='or'?'||':w==='not'?'!':w==='is'?'===':w==='isnt'?'!==':w==='nil'?'null':'';
        if(r&&!(i>0&&s.charCodeAt(i-1)===46)){
          k=j; while(k<n&&s.charCodeAt(k)===32) k++;
          if(k>=n||s.charCodeAt(k)!==58){ o+=s.slice(from,i)+r; from=j; }
        }
      }
      i=j; continue;
    }
    if(c===34){ o+=s.slice(from,i)+str(s,i,n); i=from=B_P; continue; }
    if(c===35) break;
    if(c===40||c===91||c===123){ B_DEPTH++; i++; continue; }
    if(c===41||c===93||c===125){ B_DEPTH--; i++; continue; }
    if((c===61||c===33)&&s.charCodeAt(i+1)===61&&i+1<n){
      if(s.charCodeAt(i+2)===61&&i+2<n){ i+=3; continue; }
      k=i>0?s.charCodeAt(i-1):0;
      if(c===61&&(k===60||k===62)){ i+=2; continue; }
      o+=s.slice(from,i)+(c===61?'===':'!=='); i+=2; from=i; continue;
    }
    if(c>=48&&c<=57){
      j=i+1;
      while(j<n){ k=s.charCodeAt(j); if(isWord(k)||(k===46&&s.charCodeAt(j+1)!==46)) j++; else break; }
      i=j; continue;
    }
    if(c===39){
      j=i+1;
      while(j<n){ k=s.charCodeAt(j); if(k===92) j+=2; else if(k===39) break; else j++; }
      if(j>=n){ B_ERR='This string is missing its closing quote'; i=n; break; }
      i=j+1; continue;
    }
    i++;
  }
  while(i>from&&((c=s.charCodeAt(i-1))===32||c===9||c===13)) i--;
  return o+s.slice(from,i);
}
function compile(src){
  var out='', stack=[], errs=[], n=src.length, pos=0, ln=0, openLine=0;
  var eol, i, j, c, wl, t, o, m, name, ex, a, kind, last, cont, d0;
  B_DEPTH=0;
  while(pos<=n){
    eol=src.indexOf('\n',pos); if(eol===-1) eol=n;
    ln++; i=pos; pos=eol+1; c=0;
    while(i<eol&&((c=src.charCodeAt(i))===32||c===9)) i++;
    if(i>=eol||c===35||c===13){ out+='\n'; continue; }
    B_ERR=''; o=null; cont=B_DEPTH>0;
    if(!cont&&c>=98&&c<=119){
      j=i+1; while(j<eol&&isWord(src.charCodeAt(j))) j++;
      wl=j-i;
      switch(c){
        case 108: if(wl===3&&src.startsWith('let',i)) o='const '+expr(src,j,eol); break;
        case 118: if(wl===3&&src.startsWith('var',i)) o='let '+expr(src,j,eol); break;
        case 115: if(wl===3&&src.startsWith('say',i)) o='console.log('+expr(src,j,eol)+');'; break;
        case 105: if(wl===2&&src.charCodeAt(i+1)===102){ o='if('+expr(src,j,eol)+'){'; stack.push('if',ln); } break;
        case 119: if(wl===5&&src.startsWith('while',i)){ o='while('+expr(src,j,eol)+'){'; stack.push('while',ln); } break;
        case 116: if(wl===4&&src.startsWith('test',i)){ o='test('+expr(src,j,eol)+',()=>{'; stack.push('test',ln); } break;
        case 98: if(wl===5&&src.startsWith('break',i)) o='break;'; break;
        case 99: if(wl===8&&src.startsWith('continue',i)) o='continue;'; break;
        case 114:
          if(wl===6&&src.startsWith('return',i)) o='return '+expr(src,j,eol);
          else if(wl===6&&src.startsWith('repeat',i)){ o='for(let __i=0,__n=('+expr(src,j,eol)+');__i<__n;__i++){'; stack.push('repeat',ln); }
          break;
        case 102:
          if(wl===2&&src.charCodeAt(i+1)===110){
            t=expr(src,j,eol);
            if(t.indexOf('(')<1||t.charCodeAt(t.length-1)!==41){ B_ERR='Write a function like this: fn add(a, b)'; o=''; break; }
            o='function '+t+'{'; stack.push('fn',ln);
          }else if(wl===3&&src.startsWith('for',i)){
            t=expr(src,j,eol); m=t.indexOf(' in ');
            if(m<1){ B_ERR='Write a loop like this: for i in 1..10'; o=''; break; }
            name=t.slice(0,m).trim(); ex=t.slice(m+4).trim(); a=ex.indexOf('..');
            if(a>0&&ex.charCodeAt(a+2)!==46) o='for(let '+name+'=('+ex.slice(0,a)+');'+name+'<=('+ex.slice(a+2)+');'+name+'++){';
            else o='for(const '+name+' of ('+ex+')){';
            stack.push('for',ln);
          }
          break;
        case 101:
          if(wl===3&&src.startsWith('end',i)){
            d0=B_DEPTH;
            if(expr(src,j,eol)!==''){ B_DEPTH=d0; B_ERR=''; break; }
            if(!stack.length){ B_ERR='This "end" has nothing to close'; o=''; break; }
            kind=stack[stack.length-2]; stack.length-=2; o=kind==='test'?'});':'}';
          }else if(wl===4&&src.startsWith('else',i)){
            t=expr(src,j,eol); kind=stack.length?stack[stack.length-2]:'';
            if(kind!=='if'){ B_ERR='"else" needs an "if" above it'; o=''; }
            else if(t==='') o='}else{';
            else if(t.slice(0,3)==='if '||t.slice(0,3)==='if(') o='}else if('+t.slice(2).trim()+'){';
            else { B_ERR='After "else" write nothing, or "if" and a condition'; o=''; }
          }else if(wl===6&&src.startsWith('expect',i)){
            t=expr(src,j,eol); o='if(!('+t+'))throw new Error('+JSON.stringify('expected '+t)+');';
          }
          break;
      }
    }
    if(o===null) o=expr(src,i,eol);
    if(B_DEPTH<0){ B_ERR=B_ERR||'There is a closing bracket here with no opening bracket'; B_DEPTH=0; }
    if(B_DEPTH>0&&!cont) openLine=ln;
    if(B_ERR){ if(errs.length<20) errs.push({line:ln,msg:B_ERR}); out+='\n'; continue; }
    if(B_DEPTH===0&&o.length){
      last=o.charCodeAt(o.length-1);
      /* no semicolon after a block opener or closer, an existing one, or an operator that continues on the next line */
      if(last!==123&&last!==59&&last!==44&&last!==43&&last!==45&&last!==42&&last!==47&&last!==61&&last!==46&&last!==38&&last!==124&&last!==63&&last!==58) out+=o+';\n';
      else out+=o+'\n';
    }else out+=o+'\n';
  }
  if(B_DEPTH>0&&errs.length<20) errs.push({line:openLine,msg:'A bracket opened on this line is never closed'});
  if(stack.length&&errs.length<20) errs.push({line:stack[stack.length-1],msg:'This "'+stack[stack.length-2]+'" is missing its "end"'});
  return {code:out,errors:errs,lines:ln};
}

module.exports = { compile };
