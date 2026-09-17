import {createHayamimi} from './runtime/api/hayamimi.mjs'
const messages=document.querySelector('#messages'),box=document.querySelector('#box'),mic=document.querySelector('#mic'),send=document.querySelector('#send')
const h=createHayamimi();h.onText=t=>{box.value=[box.value.trim(),t.trim()].filter(Boolean).join('\n')}
mic.onclick=async()=>{if(h.running){await h.stop();mic.textContent='●'}else{await h.start();mic.textContent='■'}}
send.onclick=()=>{const text=box.value.trim();if(!text)return;const node=document.createElement('div');node.className='message';node.textContent=text;messages.append(node);box.value='';messages.scrollTop=messages.scrollHeight}
